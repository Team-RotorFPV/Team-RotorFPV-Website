// Auth middleware + request helpers, extracted from index.js so they can be
// unit-tested in isolation (importing this module does NOT initialize Firebase
// Admin or start the server). getAuth() is only invoked when a token is actually
// present, so the no-token / bad-scheme guard paths are fully testable offline.
import { isIP } from 'node:net';
import { getAuth } from 'firebase-admin/auth';

// Normalize an IPv6-mapped IPv4 address (::ffff:1.2.3.4 -> 1.2.3.4).
export const normalizeIp = (ip) => (ip || '').replace(/^::ffff:/, '').trim();

// Private / loopback / link-local / carrier-grade-NAT ranges. These are never a
// real visitor on the public internet, so in a forwarded chain they can only be
// the hosting platform's own internal proxy hops.
export const PRIVATE_IP_RE = /^(?:10\.|127\.|0\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|169\.254\.|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|::1$|::$|f[cd]|fe[89ab])/i;

const isPublicIp = (ip) => isIP(ip) !== 0 && !PRIVATE_IP_RE.test(ip);

// Resolve the real client IP for rate limiting and analytics.
//
// SECURITY: every request header is attacker-controlled unless our own proxy
// overwrites it. Headers such as X-Real-IP, CF-Connecting-IP or True-Client-IP
// are NOT read here, because nothing guarantees the platform strips a copy the
// client sent; trusting them let anyone pick a fresh IP per request and bypass
// every rate limit.
//
// X-Forwarded-For is safe only if read from the RIGHT. Each proxy APPENDS the
// address it received the connection from, so on Render a request arrives as:
//   "<anything the client forged>, <real client IP>, 10.x.x.x, 10.x.x.x"
// The internal hops are private and vary in number per request, so we walk from
// the right, skip private addresses, and take the first public one: the address
// Render's edge actually saw. Forged entries are always to its left and never
// reached.
export function getClientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length > 0) {
    const chain = xff.split(',').map(normalizeIp).filter(Boolean);
    for (let i = chain.length - 1; i >= 0; i -= 1) {
      if (isPublicIp(chain[i])) return chain[i];
    }
  }

  // No public forwarded address (local dev, or a direct connection). Use the
  // TCP peer address. Not req.ip: with `trust proxy` enabled Express derives
  // req.ip from the LEFTMOST X-Forwarded-For entry, which the client controls.
  return normalizeIp(req.socket?.remoteAddress || '');
}

// Derive a Cloudinary public_id from a delivery URL.
// Handles our optimized URLs that include a transformation + version segment, e.g.
//   https://res.cloudinary.com/<cloud>/image/upload/c_limit,w_1200,f_auto,q_auto/v1700000000/team-rotor/abc.jpg
//   -> team-rotor/abc
export function getPublicIdFromUrl(url) {
  try {
    const u = new URL(url);
    if (!u.hostname.includes('res.cloudinary.com')) return null;
    const afterUpload = u.pathname.split('/upload/')[1];
    if (!afterUpload) return null;
    // Take everything after the version segment (vNNN/) if present; otherwise the whole path.
    const match = afterUpload.match(/v\d+\/(.+)$/);
    const path = match ? match[1] : afterUpload;
    // Strip the file extension to get the bare public_id and decode URI components (e.g., %20 to space).
    return decodeURIComponent(path.replace(/\.[^/.]+$/, ''));
  } catch {
    return null;
  }
}

// Whether a `users/{email}` document belongs to a current team member. Combines
// the checks both clients already make, so the server is never looser than
// either: the website rejects archived and non-'active' statuses, the mobile
// app rejects isActive === false. A missing `status` counts as active, matching
// older documents created before the onboarding flow existed.
export function isActiveMember(userData) {
  if (!userData) return false;
  if (userData.isArchived === true) return false;
  if (userData.isActive === false) return false;
  if (userData.status && userData.status !== 'active') return false;
  return true;
}

// Middleware factory: allow admins, or signed-in users whose `users` doc marks
// them as an active member. Any Google account can obtain a valid Firebase ID
// token from the public site, so authentication alone must never gate a
// write that costs money (e.g. Cloudinary storage). Must run after verifyAuth.
// `loadUser(email)` returns the user document data, or null if none exists;
// it's injected so the check can be unit-tested without Firestore.
export const requireActiveMember = (loadUser) => async (req, res, next) => {
  if (req.user?.admin === true) return next();

  const email = req.user?.email;
  if (!email || req.user.email_verified !== true) {
    return res.status(403).json({ error: 'Forbidden: A verified team account is required' });
  }

  try {
    const userData = await loadUser(email.toLowerCase());
    if (!isActiveMember(userData)) {
      return res.status(403).json({ error: 'Forbidden: Only active team members can upload' });
    }
    return next();
  } catch (error) {
    console.error('Membership check error:', error);
    return res.status(500).json({ error: 'Could not verify team membership' });
  }
};

// Change a user's admin / superAdmin claims WITHOUT touching their others.
// setCustomUserClaims() replaces the whole claims object, so writing just
// { admin, superAdmin } silently deleted claims such as `inventory`, `board`
// or `media` that the mobile app and the isInventoryAdmin() Firestore rule
// rely on. Always go through this helper instead of calling it directly.
// `userRecord` must be a fresh record from getUser*/createUser.
export async function updateRoleClaims(auth, userRecord, roles) {
  const merged = { ...(userRecord.customClaims || {}), ...roles };
  await auth.setCustomUserClaims(userRecord.uid, merged);
  return merged;
}

// Whether a decoded ID token belongs to a super admin. The SUPER_ADMIN_EMAIL
// fallback only counts for a verified address: Google sign-in always verifies,
// but if email/password sign-in were ever enabled, anyone could register the
// root address unverified and would otherwise be treated as super admin.
export function isSuperAdminToken(decoded, rootEmail = process.env.SUPER_ADMIN_EMAIL) {
  if (decoded?.superAdmin === true) return true;
  return Boolean(
    rootEmail &&
    decoded?.email_verified === true &&
    String(decoded.email || '').toLowerCase() === rootEmail.toLowerCase()
  );
}

// One middleware factory for the three auth levels. It checks the Bearer ID
// token (including revocation), then the role predicate, and sets req.user.
function requireToken(isAllowed, forbiddenMessage) {
  return async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized: No token provided' });
    }

    let decodedToken;
    try {
      // checkRevoked = true, so signed-out-everywhere accounts are refused.
      decodedToken = await getAuth().verifyIdToken(authHeader.slice('Bearer '.length), true);
    } catch (error) {
      console.error('Token verification error:', error.code || error.message);
      return res.status(401).json({ error: 'Unauthorized: Invalid token' });
    }
    if (!isAllowed(decodedToken)) {
      return res.status(403).json({ error: forbiddenMessage });
    }
    req.user = decodedToken;
    return next();
  };
}

// Any signed-in Firebase user.
export const verifyAuth = requireToken(() => true);

// Admins (the `admin` custom claim).
export const verifyAdmin = requireToken(
  (decoded) => decoded.admin === true,
  'Forbidden: Requires admin privileges',
);

// Super admins (the `superAdmin` claim, or the verified root address).
export const verifySuperAdmin = requireToken(
  (decoded) => isSuperAdminToken(decoded),
  'Forbidden: Requires Super Admin privileges',
);
