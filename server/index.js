import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { v2 as cloudinary } from 'cloudinary';
import { createClient } from '@supabase/supabase-js';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, KHRDracoMeshCompression } from '@gltf-transform/extensions';
import { dedup, weld, simplify, prune } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import draco3d from 'draco3dgltf';
import { Resend } from 'resend';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import helmet from 'helmet';
import geoip from 'geoip-lite';
import { initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import dotenv from 'dotenv';
import { getClientIp, getPublicIdFromUrl, verifyAdmin, verifySuperAdmin, verifyAuth, requireActiveMember, updateRoleClaims } from './auth.js';
import { sendVerificationEmail } from './verificationService.js';
import { createVerifyRouter } from './verifyFlow.js';
import { buildAuditEntry, fetchAuditLogs } from './auditLog.js';
import { visitorHashSecret, visitorId, visitExpiry } from './visitPrivacy.js';
import { InputError, parseEmail, parseApproveRequest, parseCreateMember } from './memberInput.js';
import { sanitizeFolder, normalizeMoveFolder, parseCloudinaryUrl, optimizedDeliveryUrl } from './cloudinaryAssets.js';

dotenv.config();

// Initialize Firebase Admin
// The service account key should be downloaded from Firebase Console -> Project Settings -> Service Accounts
// Save it as serviceAccountKey.json in the server folder (make sure to add to .gitignore)
import { readFileSync } from 'fs';

let serviceAccount;
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  // Use environment variable in production (Render, Railway, etc.)
  serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
} else {
  // Use local file for development
  serviceAccount = JSON.parse(readFileSync(new URL('./serviceAccountKey.json', import.meta.url)));
}

initializeApp({
  credential: cert(serviceAccount)
});

const db = getFirestore();

const app = express();

// Behind a reverse proxy, the real client IP arrives in the X-Forwarded-For
// header — the raw socket address is the proxy's. Express's own req.ip would
// take the LEFTMOST (client-forgeable) entry, so never use req.ip for anything
// security-relevant: always resolve the visitor with getClientIp().
app.set('trust proxy', true);

// Security headers. CSP is left off because this server only returns JSON (a CSP
// belongs on the frontend host, not the API), and CORP is set to cross-origin so
// the separate frontend domain can call the API without being blocked.
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:5174',
  'https://teamrotorfpv.com',
  'https://www.teamrotorfpv.com',
  'https://app.teamrotorfpv.com',      // iPhone/internal web app
  'https://inventory.teamrotorfpv.com', // inventory web app
  process.env.FRONTEND_URL
].filter(Boolean);

// Any subdomain of teamrotorfpv.com is trusted (covers future subdomains
// like admin./app./inventory. without editing this list again).
const isTrustedSubdomain = (origin) =>
  /^https:\/\/([a-z0-9-]+\.)*teamrotorfpv\.com$/i.test(origin);

// Vercel preview URLs for THIS project only.
// Pattern: https://team-rotor-fpv-website-<hash>-<team>.vercel.app
// Set VERCEL_PROJECT_NAME in server/.env to your Vercel project slug (e.g. "team-rotor-fpv-website").
const VERCEL_PROJECT_NAME = process.env.VERCEL_PROJECT_NAME || '';

const corsMiddleware = cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (server-to-server, curl, Postman)
    if (!origin) {
      return callback(null, true);
    }

    if (allowedOrigins.includes(origin) || isTrustedSubdomain(origin)) {
      return callback(null, true);
    }

    // Allow Vercel preview deployments scoped to this project only.
    // Requires VERCEL_PROJECT_NAME to be set; otherwise this check is skipped.
    if (
      VERCEL_PROJECT_NAME &&
      /^https:\/\//.test(origin) &&
      origin.endsWith('.vercel.app') &&
      origin.toLowerCase().includes(VERCEL_PROJECT_NAME.toLowerCase())
    ) {
      return callback(null, true);
    }

    callback(new Error('Not allowed by CORS'));
  }
});

// /api/verify is opened from an email and its Confirm button posts a form from
// the API's own domain. That is a normal page visit, not a cross-origin API
// call, so CORS doesn't apply (and the allowlist would wrongly reject it).
app.use((req, res, next) => (req.path === '/api/verify' ? next() : corsMiddleware(req, res, next)));

app.use(express.json());

// ── Cloudinary configuration ──
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// ── Supabase Storage (large 3D model files; Cloudinary's free raw cap is 10 MB) ──
// Uploads are signed with the service-role key on the server, never exposed to
// the browser. The bucket is public-read so the models can be fetched by three.js.
const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET || 'drone-models';
const supabase = (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    })
  : null;
if (!supabase) {
  console.warn('[Supabase] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — 3D model uploads are disabled.');
}

// ── glTF optimization (runs server-side on every model upload) ──
// Lazily build a NodeIO with the Draco encoder/decoder wired in. Created once
// and reused; the WASM modules take a moment to initialize.
let _gltfIOPromise = null;
function getGltfIO() {
  if (!_gltfIOPromise) {
    _gltfIOPromise = (async () => {
      const [encoder, decoder] = await Promise.all([
        draco3d.createEncoderModule(),
        draco3d.createDecoderModule(),
      ]);
      return new NodeIO()
        .registerExtensions(ALL_EXTENSIONS)
        .registerDependencies({ 'draco3d.encoder': encoder, 'draco3d.decoder': decoder });
    })();
  }
  return _gltfIOPromise;
}

// Optimize an uploaded model buffer: clean + simplify while KEEPING parts
// separate (no join/flatten, so named parts stay clickable), then Draco-compress.
// Returns an optimized GLB Buffer. Throws on unreadable input (caller falls back).
async function optimizeModel(inputBuffer, ext) {
  const io = await getGltfIO();
  const doc = ext === 'gltf'
    ? await io.readJSON({ json: JSON.parse(inputBuffer.toString('utf8')), resources: {} })
    : await io.readBinary(new Uint8Array(inputBuffer));

  await MeshoptSimplifier.ready;
  await doc.transform(
    dedup(),
    weld(),
    simplify({ simplifier: MeshoptSimplifier, error: 0.005, ratio: 0.0 }),
    prune(),
  );

  // Presence of this extension makes writeBinary Draco-encode the geometry.
  doc.createExtension(KHRDracoMeshCompression).setRequired(true);
  return Buffer.from(await io.writeBinary(doc));
}

// ── Multer configuration (memory storage, media up to 20 MB) ──
const ALLOWED_MIME_TYPES = [
  'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif', 'image/heic-sequence', 'image/avif',
  'video/mp4', 'video/webm', 'video/quicktime',
  'application/octet-stream', '', 'application/pdf',
  'model/gltf-binary', 'model/gltf+json' // 3D drone models (.glb/.gltf)
];
const ALLOWED_EXTS = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic', 'heif', 'avif', 'mp4', 'webm', 'mov', 'pdf', 'glb', 'gltf'];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50 MB (3D models are large)
  },
  fileFilter: (req, file, cb) => {
    const ext = file.originalname ? file.originalname.split('.').pop().toLowerCase() : '';
    
    // Browsers often don't have a registered MIME type for HEIC files 
    // and send them as application/octet-stream or empty string.
    // We check both the mime type and the file extension for safety.
    const isValidMime = ALLOWED_MIME_TYPES.includes(file.mimetype);
    const isValidExt = ALLOWED_EXTS.includes(ext);

    if (!(isValidMime && isValidExt)) {
      return cb(new Error('Only JPEG, PNG, WebP, GIF, HEIC, AVIF images, MP4/WebM/MOV videos, PDF, and GLB/glTF 3D models are allowed.'));
    }
    cb(null, true);
  },
});

const logAudit = async (action, userEmail, targetEmail) => {
  const logMessage = `[ROLE CHANGE] ${userEmail} ${action} ${targetEmail}`;
  console.log(logMessage);
  try {
    await db.collection('audit_logs').add(
      buildAuditEntry({ category: 'role_change', action, actor: userEmail, target: targetEmail })
    );
  } catch (e) {
    console.error("Failed to write audit log:", e);
  }
};

// Endpoint to grant admin access
app.post('/api/setAdmin', verifySuperAdmin, async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required' });

  try {
    let userRecord;
    try {
      userRecord = await getAuth().getUserByEmail(email);
    } catch (err) {
      if (err.code === 'auth/user-not-found') {
        userRecord = await getAuth().createUser({ email });
      } else throw err;
    }

    const isSuper = userRecord.customClaims?.superAdmin === true;
    await updateRoleClaims(getAuth(), userRecord, { admin: true, superAdmin: isSuper });
    await db.collection('admins').doc(email).set({ email, isSuperAdmin: isSuper, isRoot: email === process.env.SUPER_ADMIN_EMAIL }, { merge: true });
    await logAudit('granted admin to', req.user.email, email);
    res.json({ message: `Successfully granted admin privileges to ${email}` });
  } catch (error) {
    console.error('Error setting admin:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Endpoint to revoke admin access
app.post('/api/removeAdmin', verifySuperAdmin, async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required' });

  if (email === process.env.SUPER_ADMIN_EMAIL) {
    return res.status(403).json({ error: 'The root Super Admin cannot be modified.' });
  }
  if (req.user.email === email) {
    return res.status(400).json({ error: 'You cannot remove your own privileges.' });
  }

  try {
    let userRecord;
    try {
      userRecord = await getAuth().getUserByEmail(email);
    } catch (err) {
      if (err.code === 'auth/user-not-found') {
        // User doesn't exist in Auth, just clean up Firestore and return success
        await db.collection('admins').doc(email).delete();
        await logAudit('revoked admin from', req.user.email, email);
        return res.json({ message: `Successfully revoked admin privileges from ${email}` });
      } else throw err;
    }

    if (userRecord.customClaims?.superAdmin === true) {
      const adminsSnapshot = await db.collection('admins').where('isSuperAdmin', '==', true).get();
      if (adminsSnapshot.size <= 1 && req.user.email !== process.env.SUPER_ADMIN_EMAIL) {
         return res.status(400).json({ error: 'At least one Super Admin must remain.' });
      }
    }

    await updateRoleClaims(getAuth(), userRecord, { admin: false, superAdmin: false });
    await getAuth().revokeRefreshTokens(userRecord.uid);
    await db.collection('admins').doc(email).delete();
    await logAudit('revoked admin from', req.user.email, email);
    res.json({ message: `Successfully revoked admin privileges from ${email}` });
  } catch (error) {
    console.error('Error revoking admin:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Endpoint to set super admin
app.post('/api/setSuperAdmin', verifySuperAdmin, async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required' });

  try {
    let userRecord;
    try {
      userRecord = await getAuth().getUserByEmail(email);
    } catch (err) {
      if (err.code === 'auth/user-not-found') {
        userRecord = await getAuth().createUser({ email });
      } else throw err;
    }
    
    await updateRoleClaims(getAuth(), userRecord, { admin: true, superAdmin: true });
    await db.collection('admins').doc(email).set({ email, isSuperAdmin: true, isRoot: email === process.env.SUPER_ADMIN_EMAIL }, { merge: true });
    await logAudit('promoted to super admin', req.user.email, email);
    res.json({ message: `Successfully promoted ${email} to Super Admin` });
  } catch (error) {
    console.error('Error setting super admin:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Endpoint to remove super admin
app.post('/api/removeSuperAdmin', verifySuperAdmin, async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required' });

  if (email === process.env.SUPER_ADMIN_EMAIL) {
    return res.status(403).json({ error: 'The root Super Admin cannot be modified.' });
  }
  if (req.user.email === email) {
    return res.status(400).json({ error: 'You cannot demote yourself.' });
  }

  try {
    const adminsSnapshot = await db.collection('admins').where('isSuperAdmin', '==', true).get();
    if (adminsSnapshot.size <= 1 && req.user.email !== process.env.SUPER_ADMIN_EMAIL) {
       return res.status(400).json({ error: 'At least one Super Admin must remain.' });
    }

    let userRecord;
    try {
      userRecord = await getAuth().getUserByEmail(email);
    } catch (err) {
      if (err.code === 'auth/user-not-found') {
        // User doesn't exist, just clean up Firestore
        await db.collection('admins').doc(email).set({ isSuperAdmin: false }, { merge: true });
        await logAudit('demoted from super admin', req.user.email, email);
        return res.json({ message: `Successfully demoted ${email} to regular Admin` });
      } else throw err;
    }

    await updateRoleClaims(getAuth(), userRecord, { admin: true, superAdmin: false });
    await getAuth().revokeRefreshTokens(userRecord.uid);
    await db.collection('admins').doc(email).set({ isSuperAdmin: false }, { merge: true });
    await logAudit('demoted from super admin', req.user.email, email);
    res.json({ message: `Successfully demoted ${email} to regular Admin` });
  } catch (error) {
    console.error('Error removing super admin:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Endpoint to list all admins (optional utility)
app.get('/api/admins', verifyAdmin, async (req, res) => {
  try {
    const adminsSnapshot = await db.collection('admins').get();
    
    if (!adminsSnapshot.empty) {
      const admins = [];
      adminsSnapshot.forEach(doc => admins.push(doc.data()));
      return res.json({ admins });
    }

    // Fallback/Migration: If collection is empty, migrate from Firebase Auth
    const listUsersResult = await getAuth().listUsers(1000);
    const admins = listUsersResult.users
      .filter(user => user.customClaims && user.customClaims.admin === true)
      .map(user => ({
         email: user.email,
         isSuperAdmin: user.customClaims.superAdmin === true || user.email === process.env.SUPER_ADMIN_EMAIL,
         isRoot: user.email === process.env.SUPER_ADMIN_EMAIL
      }));
      
    // Populate the Firestore collection for future fast reads
    if (admins.length > 0) {
      const batch = db.batch();
      admins.forEach(admin => {
        const docRef = db.collection('admins').doc(admin.email);
        batch.set(docRef, admin);
      });
      await batch.commit();
    }
      
    res.json({ admins });
  } catch (error) {
    console.error('Error listing admins:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Upload rate limiter: 20 uploads per 10 minutes per account ──
// This caps memory pressure from concurrent large-file uploads.
// Placed before Multer so rate-limited requests are rejected before
// any file bytes are buffered into RAM. Every upload route authenticates
// first, so the limit follows the signed-in account (uid) rather than the
// IP: a member can't dodge it by switching networks, and teammates sharing
// one campus IP don't use up each other's allowance.
const uploadLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 20,
  message: { error: 'Too many uploads. Please wait before uploading more files.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => (req.user?.uid ? `uid:${req.user.uid}` : ipKeyGenerator(getClientIp(req))),
});

// Only admins and active team members may upload (see requireActiveMember).
const requireUploader = requireActiveMember(async (email) => {
  const snap = await db.collection('users').doc(email).get();
  return snap.exists ? snap.data() : null;
});

// ── Cloudinary folder naming: see sanitizeFolder() in cloudinaryAssets.js ──
// An email's '@' and '.' do not survive sanitisation, so the folder is derived
// from the sanitised email rather than the raw one.
const ownProfileFolder = (email) =>
  `users/${sanitizeFolder((email || '').toLowerCase())}`;

// ── Image upload endpoint (admins + active team members, signed Cloudinary upload) ──
// Order matters: auth and membership are checked before the limiter and Multer,
// so outsiders are rejected before any file bytes are buffered.
app.post('/api/upload', verifyAuth, requireUploader, uploadLimiter, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Sanitize the caller-supplied folder
    const safeFolder = sanitizeFolder(req.body.folder);

    // If user is not an admin, they can ONLY upload to their own profile folder.
    //
    // Both sides of this comparison must go through sanitizeFolder(). The
    // sanitizer strips '@' and '.', so comparing the sanitized folder against a
    // raw email could never match and every non-admin profile-picture upload
    // was rejected with a 403. Admins skipped the branch entirely, which is why
    // it went unnoticed.
    if (!req.user.admin) {
      const ownFolder = ownProfileFolder(req.user.email);
      if (safeFolder !== ownFolder) {
        return res.status(403).json({ error: 'Forbidden: You can only upload to your own profile folder' });
      }
    }

    const targetFolder = safeFolder ? `team-rotor/${safeFolder}` : 'team-rotor';

    const uploadExt = req.file.originalname ? req.file.originalname.split('.').pop().toLowerCase() : '';
    const isRaw = req.file.mimetype === 'application/pdf' || uploadExt === 'glb' || uploadExt === 'gltf';
    const rType = isRaw ? 'raw' : 'auto';

    const result = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder: targetFolder, resource_type: rType },
        (error, result) => {
          if (error) reject(error);
          else resolve(result);
        }
      );
      stream.end(req.file.buffer);
    });

    res.json({
      // Cloudinary reports the resource_type it detected; images get resized
      // and auto-formatted (HEIC -> WebP etc.), videos get eco quality.
      secure_url: optimizedDeliveryUrl(result),
      width: result.width,
      height: result.height,
      public_id: result.public_id,
      resource_type: result.resource_type
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Upload failed' });
  }
});

// 🗑️ Delete a Cloudinary asset by its delivery URL or publicId (admin-only) 🗑️
app.post('/api/delete-asset', verifyAdmin, async (req, res) => {
  try {
    const { url, publicId: providedPublicId } = req.body;
    
    let publicId = providedPublicId;
    
    if (!publicId && url) {
      publicId = getPublicIdFromUrl(url);
    }
    
    if (!publicId) {
      if (url) return res.json({ result: 'skipped', message: 'No publicId provided and could not derive from URL' });
      return res.status(400).json({ error: 'publicId or url is required' });
    }

    console.log(`[Cloudinary Delete] Attempting to delete:`, { url, publicId });
    
    // Cloudinary destroy defaults to resource_type: 'image'. If not found, it might be a video or raw (PDF).
    let result = await cloudinary.uploader.destroy(publicId);
    if (result.result === 'not found') {
       result = await cloudinary.uploader.destroy(publicId, { resource_type: 'video' });
    }
    if (result.result === 'not found') {
       result = await cloudinary.uploader.destroy(publicId, { resource_type: 'raw' });
    }
    
    console.log(`[Cloudinary Delete] Result:`, result);
    
    if (result.result !== 'ok' && result.result !== 'not found') {
      throw new Error(`Cloudinary deletion failed: ${result.result}`);
    }
    
    res.json({ message: 'Asset deletion processed', result: result.result, publicId });
  } catch (error) {
    console.error('[Cloudinary Delete] Error:', error);
    res.status(500).json({ error: 'Delete failed' });
  }
});

// 📦 Move/rename a Cloudinary asset into a different folder (admin-only) 📦
// Used when an item's organizing folder should change (e.g. switching an event
// between Upcoming/Past). Keeps the original asset basename, only swaps the folder.
// `toFolder` is relative (without the team-rotor/ prefix), matching /api/upload.
app.post('/api/move-asset', verifyAdmin, async (req, res) => {
  try {
    const { url, toFolder } = req.body;
    if (!url || !toFolder) {
      return res.status(400).json({ error: 'url and toFolder are required' });
    }

    const folder = normalizeMoveFolder(toFolder);
    if (!folder) {
      return res.status(400).json({ error: 'toFolder must contain letters, numbers, "/", "_" or "-"' });
    }

    const asset = parseCloudinaryUrl(url);
    // Externally pasted (non-Cloudinary) URLs can't be moved — return as-is.
    if (!asset) {
      return res.json({ result: 'skipped', secure_url: url });
    }

    const basename = asset.publicId.split('/').pop();
    const newPublicId = `team-rotor/${folder}/${basename}`;

    // Already in the right place — nothing to do.
    if (newPublicId === asset.publicId) {
      return res.json({ result: 'unchanged', secure_url: url });
    }

    // The resource type comes from the URL itself, so there is one rename call
    // and its real error surfaces. overwrite is off: a move must never replace
    // an unrelated asset that already has the target name.
    let result;
    try {
      result = await cloudinary.uploader.rename(asset.publicId, newPublicId, {
        resource_type: asset.resourceType,
        overwrite: false,
      });
    } catch (error) {
      const message = String(error?.message || error?.error?.message || '');
      if (/already exists/i.test(message)) {
        return res.status(409).json({ error: 'An asset with that name already exists in the target folder.' });
      }
      throw error;
    }

    console.log('[Cloudinary Move]', { from: asset.publicId, to: result.public_id });
    res.json({ result: 'ok', secure_url: optimizedDeliveryUrl(result), public_id: result.public_id, resource_type: result.resource_type });
  } catch (error) {
    console.error('[Cloudinary Move] Error:', error);
    res.status(500).json({ error: 'Move failed' });
  }
});

// ── 3D model upload endpoint (admin-only, Supabase Storage) ──
// GLB/glTF files are too large for Cloudinary's free raw tier, so they live in
// a public Supabase bucket. Returns { url, path } — store both in Firestore so
// the asset can be deleted later by `path`.
app.post('/api/upload-model', verifyAdmin, uploadLimiter, upload.single('model'), async (req, res) => {
  try {
    if (!supabase) return res.status(503).json({ error: '3D model storage is not configured.' });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const ext = req.file.originalname ? req.file.originalname.split('.').pop().toLowerCase() : '';
    if (ext !== 'glb' && ext !== 'gltf') {
      return res.status(400).json({ error: 'Only .glb or .gltf models are allowed.' });
    }

    // Optimize before storing (clean + simplify, parts kept separate, then Draco).
    // On any failure, fall back to storing the original so uploads never break.
    let buffer = req.file.buffer;
    let outExt = ext;
    let optimized = false;
    const originalBytes = req.file.buffer.length;
    try {
      const result = await optimizeModel(req.file.buffer, ext);
      if (result && result.length > 0) {
        buffer = result;
        outExt = 'glb';
        optimized = true;
      }
    } catch (optErr) {
      console.error('[Model optimize] failed — storing original:', optErr.message || optErr);
    }

    // Sanitize the folder and build a collision-proof object path.
    const folder = sanitizeFolder(req.body.folder || 'models') || 'models';
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const path = `${folder}/${unique}.${outExt}`;
    const contentType = outExt === 'glb' ? 'model/gltf-binary' : 'model/gltf+json';

    const { error: upErr } = await supabase.storage
      .from(SUPABASE_BUCKET)
      .upload(path, buffer, { contentType, upsert: false });
    if (upErr) throw upErr;

    console.log(`[Model upload] ${optimized ? 'optimized' : 'stored as-is'}: ${originalBytes} → ${buffer.length} bytes`);
    const { data } = supabase.storage.from(SUPABASE_BUCKET).getPublicUrl(path);
    res.json({ url: data.publicUrl, path, optimized });
  } catch (error) {
    console.error('Model upload error:', error);
    res.status(500).json({ error: 'Model upload failed' });
  }
});

// ── Delete a 3D model from Supabase Storage by object path (admin-only) ──
app.post('/api/delete-model', verifyAdmin, async (req, res) => {
  try {
    if (!supabase) return res.status(503).json({ error: '3D model storage is not configured.' });
    const { path } = req.body;
    if (!path) return res.status(400).json({ error: 'No path provided' });

    const { error } = await supabase.storage.from(SUPABASE_BUCKET).remove([path]);
    if (error) throw error;
    res.json({ result: 'ok' });
  } catch (error) {
    console.error('Model delete error:', error);
    res.status(500).json({ error: 'Model delete failed' });
  }
});

// ── Contact Us Endpoint ──
const resend = new Resend(process.env.RESEND_API_KEY);

// Verified sender on the team's domain; override via env if the domain changes.
const CONTACT_FROM = process.env.CONTACT_FROM || 'Team RotorFPV <contact@teamrotorfpv.com>';
// Comma-separated list of recipients, e.g. "teamrotorfpv@vit.ac.in,backup@example.com".
const CONTACT_RECIPIENTS = (process.env.CONTACT_RECIPIENTS || '')
  .split(',')
  .map((addr) => addr.trim())
  .filter(Boolean);

const contactLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 contact requests per window
  message: { error: 'Too many requests, please try again later.' },
  keyGenerator: (req) => ipKeyGenerator(getClientIp(req)),
});

app.post('/api/contact', contactLimiter, async (req, res) => {
  try {
    const { name, email, phone, organization, queryType, message, honeypot } = req.body;

    // Basic anti-spam honeypot field check
    if (honeypot) {
      // Spam detected, silently reject but return success to fool bots
      return res.status(200).json({ success: true, message: 'Message sent successfully.' });
    }

    // Required fields validation
    if (!name || !email || !message || !queryType) {
      return res.status(400).json({ success: false, error: 'Missing required fields' });
    }

    // Email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ success: false, error: 'Invalid email format' });
    }

    // Message length limit
    if (message.length > 2000) {
      return res.status(400).json({ success: false, error: 'Message is too long (max 2000 characters)' });
    }

    const contactDoc = {
      name,
      email,
      phone: phone || '',
      organization: organization || '',
      queryType,
      message,
      createdAt: new Date(),
      status: 'unread',
      ipAddress: getClientIp(req),
      repliedAt: null
    };

    // Save to Firestore
    const docRef = await db.collection('contact_messages').add(contactDoc);

    // Format Email
    const submissionDate = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'long', timeStyle: 'short' });
    const emailBody = `Name: ${name}
Email: ${email}
Phone: ${phone || 'N/A'}
Organization: ${organization || 'N/A'}
Query Type: ${queryType}

Message:
${message}

Submitted on:
${submissionDate} IST`;

    // Send notification email via Resend.
    // Best-effort only: the message is already persisted to Firestore above and is
    // visible in the admin dashboard, so an email failure must NOT fail the request
    // (that would make users resubmit and create duplicate entries).
    if (process.env.RESEND_API_KEY && CONTACT_RECIPIENTS.length > 0) {
      const { error } = await resend.emails.send({
        from: CONTACT_FROM,
        to: CONTACT_RECIPIENTS,
        subject: '[Team RotorFPV Website] New Contact Form Submission',
        text: emailBody
      });

      if (error) {
        console.error("Resend API Error:", error.message || error);
      } else {
        console.log(`Contact notification email sent to ${CONTACT_RECIPIENTS.length} recipient(s).`);
      }
    } else {
      console.warn("RESEND_API_KEY or CONTACT_RECIPIENTS not set; skipping email notification.");
    }

    res.status(200).json({ success: true, message: 'Message sent successfully.' });
  } catch (error) {
    console.error('Error handling contact form:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── Visitor Analytics ──
// Public endpoint the frontend pings on each page view. The real client IP is
// resolved by getClientIp() (rightmost public address in the forwarded chain); we
// then look up a coarse location offline with geoip-lite — no external API call,
// no API key. Only a keyed hash of the IP is stored, never the IP itself or
// coordinates (see visitPrivacy.js). Writes go through the Admin SDK, so the 'visits' collection stays
// fully locked down by the default-deny Firestore rule (no client read/write).
const VISITOR_SECRET = visitorHashSecret(process.env, serviceAccount);

const trackLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30,             // cap pageview spam per IP
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(getClientIp(req)),
  // Analytics is best-effort: swallow over-limit pings instead of erroring.
  handler: (req, res) => res.status(204).end(),
});

app.post('/api/track', trackLimiter, async (req, res) => {
  try {
    const ua = (req.headers['user-agent'] || '').slice(0, 300);

    // Skip obvious bots/crawlers so the numbers reflect real humans.
    if (/bot|crawl|spider|slurp|bingpreview|facebookexternalhit|headless/i.test(ua)) {
      return res.status(204).end();
    }

    const ip = getClientIp(req);
    const path = typeof req.body?.path === 'string' ? req.body.path.slice(0, 200) : '/';
    const geo = geoip.lookup(ip) || null;

    const now = new Date();
    await db.collection('visits').add({
      visitorId: visitorId(ip, VISITOR_SECRET),
      path,
      userAgent: ua,
      country: geo?.country || null, // ISO-2 country code, e.g. "IN"
      region: geo?.region || null,
      city: geo?.city || null,
      timestamp: now,
      expireAt: visitExpiry(now),    // deleted by the Firestore TTL policy on visits.expireAt
    });

    res.status(204).end();
  } catch (error) {
    // Tracking must never break a page load — log and move on.
    console.error('Visit tracking error:', error.message || error);
    res.status(204).end();
  }
});

// Admin-only analytics summary for the dashboard Traffic tab.
// Accurate lifetime total comes from a cheap count() aggregation; the breakdowns
// (unique visitors, country split, recent feed) are computed over the most recent
// ANALYTICS_SCAN_LIMIT visits to keep per-request reads bounded.
const ANALYTICS_SCAN_LIMIT = 2000;

app.get('/api/analytics', verifyAdmin, async (req, res) => {
  try {
    const [countSnap, snap] = await Promise.all([
      db.collection('visits').count().get(),
      db.collection('visits').orderBy('timestamp', 'desc').limit(ANALYTICS_SCAN_LIMIT).get(),
    ]);

    const now = Date.now();
    const DAY = 24 * 60 * 60 * 1000;

    const uniqueVisitors = new Set();
    const countryCounts = {};
    const recent = [];
    let last24h = 0;
    let last7d = 0;

    snap.forEach((doc) => {
      const v = doc.data();
      const ts = v.timestamp?.toDate ? v.timestamp.toDate() : new Date(v.timestamp);
      const age = now - ts.getTime();

      // Older visits still hold a raw ip: hash it the same way so it counts
      // as the same visitor and the IP itself never leaves the server.
      const visitor = v.visitorId || visitorId(v.ip, VISITOR_SECRET);
      if (visitor) uniqueVisitors.add(visitor);
      if (age <= DAY) last24h += 1;
      if (age <= 7 * DAY) last7d += 1;

      const country = v.country || 'Unknown';
      countryCounts[country] = (countryCounts[country] || 0) + 1;

      if (recent.length < 100) {
        recent.push({
          visitor: visitor || '',
          city: v.city || '',
          region: v.region || '',
          country,
          path: v.path || '',
          timestamp: ts.toISOString(),
        });
      }
    });

    const byCountry = Object.entries(countryCounts)
      .map(([country, count]) => ({ country, count }))
      .sort((a, b) => b.count - a.count);

    res.json({
      totalVisits: countSnap.data().count,
      scannedWindow: snap.size,           // breakdowns below are over this many recent visits
      windowCapped: snap.size === ANALYTICS_SCAN_LIMIT,
      uniqueVisitors: uniqueVisitors.size,
      last24h,
      last7d,
      byCountry,
      recent,
    });
  } catch (error) {
    console.error('Analytics error:', error);
    res.status(500).json({ error: 'Failed to load analytics' });
  }
});

// Endpoint to fetch unified logs for Super Admins
app.get('/api/logs', verifySuperAdmin, async (req, res) => {
  try {
    const limitNum = 200; // Fetch top 200 from each to ensure good overlap
    const [activitySnap, auditLogs, contactSnap] = await Promise.all([
      db.collection('activity_logs').orderBy('timestamp', 'desc').limit(limitNum).get(),
      fetchAuditLogs(db, limitNum), // handles every stored audit shape, see auditLog.js
      db.collection('contact_messages').orderBy('createdAt', 'desc').limit(limitNum).get()
    ]);

    const logs = [];

    activitySnap.forEach(doc => {
      const data = doc.data();
      logs.push({
        id: doc.id,
        type: 'activity',
        user: data.userEmail, // enforced == the writer's own email by firestore.rules
        action: data.actionType,
        target: data.targetType,
        details: data.details,
        // The `timestamp` field is supplied by the client and can be faked, so
        // show Firestore's own server-side write time instead. (The query above
        // still orders by `timestamp`, the only indexed field older docs have.)
        timestamp: doc.createTime.toDate().toISOString(),
      });
    });

    logs.push(...auditLogs);

    contactSnap.forEach(doc => {
      const data = doc.data();
      logs.push({
        id: doc.id,
        type: 'contact',
        user: data.email,
        action: 'CONTACT_SUBMISSION',
        target: 'Contact Form',
        details: `Message from ${data.name}: ${data.queryType}`,
        timestamp: data.createdAt?.toDate ? data.createdAt.toDate().toISOString() : new Date(data.createdAt).toISOString()
      });
    });

    // Sort combined logs by timestamp descending
    logs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    res.json({ logs: logs.slice(0, 500) }); // Return top 500 overall
  } catch (error) {
    console.error('Logs fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch logs' });
  }
});

// ── Verification & Onboarding Endpoints ──

// Build human-readable mirror fields so the raw Firestore user document is
// legible in the Firebase console. `tags` is stored as an array of tag document
// IDs and `customFields` is keyed by custom-field document IDs — both look like
// random strings in the console. These mirrors (`tagNames`, `customFieldsReadable`)
// are for readability only; the app always reads the ID-based `tags`/`customFields`
// as the source of truth, so a rename may leave a mirror briefly stale without any
// functional impact.
async function buildReadableMirrors(tagIds = [], customFieldsMap = {}) {
  const [tagsSnap, fieldsSnap] = await Promise.all([
    db.collection('tags').get(),
    db.collection('custom_fields').get(),
  ]);
  const tagNameById = {};
  tagsSnap.forEach(d => { tagNameById[d.id] = d.data().name; });
  const fieldNameById = {};
  fieldsSnap.forEach(d => { fieldNameById[d.id] = d.data().name; });

  const tagNames = (tagIds || []).map(id => tagNameById[id]).filter(Boolean);
  const customFieldsReadable = {};
  for (const [fieldId, value] of Object.entries(customFieldsMap || {})) {
    customFieldsReadable[fieldNameById[fieldId] || fieldId] = value;
  }
  return { tagNames, customFieldsReadable };
}

// Write (or merge into) a provisioned member's users/{email} doc. Existing
// verified members keep their active status; everyone else starts unverified.
async function provisionMember({ email, name = '', tags, customFields }) {
  const userRef = db.collection('users').doc(email);
  const userDoc = await userRef.get();
  const existing = userDoc.exists ? userDoc.data() : null;
  const alreadyVerified = Boolean(existing && (existing.status === 'active' || existing.emailVerified));

  // Readable mirrors so the raw Firestore doc is legible in the console.
  const { tagNames, customFieldsReadable } = await buildReadableMirrors(tags, customFields);

  await userRef.set({
    email,
    name,
    jobTitle: '',
    linkedin: '',
    github: '',
    roomNumber: '',
    image: '',
    tags,
    tagNames,
    customFields,
    customFieldsReadable,
    status: alreadyVerified ? (existing.status || 'active') : 'approved_unverified',
    emailVerified: alreadyVerified,
  }, { merge: true });

  return { alreadyVerified };
}

// Turn a validation failure into a 400 and anything else into a generic 500.
function sendRouteError(res, error, label) {
  if (error instanceof InputError) return res.status(400).json({ error: error.message });
  console.error(`${label}:`, error);
  return res.status(500).json({ error: `${label} failed` });
}

app.post('/api/admin/requests/approve', verifySuperAdmin, async (req, res) => {
  try {
    const input = parseApproveRequest(req.body);

    // Check the request first, and only mark it approved once the member is
    // provisioned and emailed: a failure part-way leaves it pending to retry.
    const requestRef = db.collection('join_requests').doc(input.requestId);
    const requestSnap = await requestRef.get();
    if (!requestSnap.exists) return res.status(404).json({ error: 'Join request not found' });
    if (requestSnap.data().status === 'rejected') {
      return res.status(409).json({ error: 'This request was rejected' });
    }

    const { alreadyVerified } = await provisionMember(input);
    if (!alreadyVerified) {
      await sendVerificationEmail(input.email, 'onboarding', { tags: input.tags });
    }
    await requestRef.update({ status: 'approved_unverified' });

    await db.collection('audit_logs').add(
      buildAuditEntry({ category: 'onboarding', action: 'join_request_approved', actor: req.user.email, target: input.email })
    );

    res.json({ success: true });
  } catch (error) {
    sendRouteError(res, error, 'Approving request');
  }
});

// Resend the onboarding email to the signed-in person only. It used to take
// any email in the body, which let anyone check who is on the team (404 vs
// 400) and send verification emails to any pending member. Admin.jsx keeps
// the ID token from the moment it found the account unverified.
// Per-account limit for endpoints that send email to the signed-in person.
// Each call creates its own counter, so the endpoints don't share a budget
// (they used to share contactLimiter with the public contact form).
const accountEmailLimiter = () => rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3,
  message: { error: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `uid:${req.user.uid}`,
});

app.post('/api/resend-verification', verifyAuth, accountEmailLimiter(), async (req, res) => {
  try {
    if (req.user.email_verified !== true || !req.user.email) {
      return res.status(403).json({ error: 'Sign in with your verified Google account first' });
    }
    const email = req.user.email.toLowerCase();
    const userSnap = await db.collection('users').doc(email).get();
    if (!userSnap.exists || userSnap.data().status !== 'approved_unverified') {
      return res.status(409).json({ error: 'There is no pending verification for this account' });
    }

    await sendVerificationEmail(email, 'onboarding', { tags: userSnap.data().tags || [] });
    res.json({ success: true });
  } catch (error) {
    sendRouteError(res, error, 'Resending verification');
  }
});

app.post('/api/admin/users/create', verifySuperAdmin, async (req, res) => {
  try {
    const input = parseCreateMember(req.body);

    const existing = await db.collection('users').doc(input.email).get();
    if (existing.exists) {
      return res.status(400).json({ error: 'User already exists' });
    }

    await provisionMember(input);
    await sendVerificationEmail(input.email, 'onboarding', { tags: input.tags });

    await db.collection('audit_logs').add(
      buildAuditEntry({ category: 'onboarding', action: 'team_member_created', actor: req.user.email, target: input.email })
    );

    res.json({ success: true });
  } catch (error) {
    sendRouteError(res, error, 'Creating user');
  }
});

app.post('/api/migrate/request', verifyAuth, accountEmailLimiter(), async (req, res) => {
  try {
    const newEmail = parseEmail(req.body?.newEmail);
    const oldEmail = req.user.email;
    if (req.user.email_verified !== true || !oldEmail) {
      return res.status(403).json({ error: 'Sign in with your verified Google account first' });
    }

    // Check if new email already exists
    const snap = await db.collection('users').doc(newEmail).get();
    if (snap.exists) {
      return res.status(400).json({ error: 'An account with this email already exists' });
    }

    // Generate token and send email
    await sendVerificationEmail(newEmail, 'migration', { oldEmail });

    res.json({ success: true, message: 'Verification email sent' });
  } catch (error) {
    sendRouteError(res, error, 'Requesting migration');
  }
});

// Email verification links: GET shows a confirm page, POST applies it inside a
// Firestore transaction. See verifyFlow.js for why GET must not change state.
app.use(createVerifyRouter({ db, auth: getAuth() }));

// Handle multer errors (file too large, wrong type)
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'File too large. Maximum size is 50 MB.' });
    }
    return res.status(400).json({ error: err.message });
  }
  if (err.message && err.message.includes('are allowed')) {
    return res.status(400).json({ error: err.message });
  }
  next(err);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Admin backend server running on port ${PORT}`);
});
