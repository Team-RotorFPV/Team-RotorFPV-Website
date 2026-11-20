// Email-link verification (onboarding activation + email migration).
//
// Why GET only shows a page: mail security scanners (Outlook Safe Links,
// Gmail/Proofpoint/Mimecast link checkers) open every link in an email before
// the person does. When GET performed the action, a scanner could activate an
// account or complete an email migration on its own and burn the token. Now:
//   GET  /api/verify?token=…  read-only: checks the token, shows a Confirm button
//   POST /api/verify           does the work, only when a person clicks Confirm
//
// The POST runs entirely inside one Firestore transaction: the token check,
// every data change, marking the token used, and the audit entry either all
// happen or none do. That also stops a double-click (or two tabs) from using
// the same token twice.
//
// Dependencies are injected so this can be exercised against the Firestore
// emulator with a fake Auth client.
import express from 'express';
import { hashToken } from './tokenHash.js';
import { updateRoleClaims } from './auth.js';
import { buildAuditEntry } from './auditLog.js';

// A failure whose message is safe and useful to show the person.
class VerifyError extends Error {}

const escapeHtml = (value) => String(value)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function renderPage({ title, message, tone = 'info', confirm = null }) {
  const color = { ok: '#2e7d32', error: '#d32f2f', info: '#0a192f' }[tone];
  const form = confirm ? `
    <form method="POST" action="/api/verify" style="margin-top: 28px;">
      <input type="hidden" name="token" value="${escapeHtml(confirm.token)}">
      <button type="submit" style="background: #64ffda; color: #0a192f; border: 0; padding: 12px 24px; border-radius: 4px; font-weight: bold; font-size: 1em; cursor: pointer;">${escapeHtml(confirm.label)}</button>
    </form>` : '';
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>${escapeHtml(title)} | Team Rotor</title>
</head>
<body style="font-family: sans-serif; padding: 40px 16px; text-align: center; margin: 0;">
  <h2 style="color: ${color};">${escapeHtml(title)}</h2>
  <p style="max-width: 480px; margin: 0 auto;">${escapeHtml(message)}</p>${form}
</body>
</html>`;
}

const PROMPTS = {
  onboarding: {
    title: 'Activate your account',
    message: 'Click below to verify your email address and activate your Team Rotor account.',
    label: 'Verify my email',
  },
  migration: {
    title: 'Confirm email migration',
    message: 'Click below to move your Team Rotor account to this email address. You will sign in with this address from now on.',
    label: 'Confirm migration',
  },
};

// Validate a token document. Throws VerifyError with a person-facing reason.
function assertUsable(tokenSnap) {
  if (!tokenSnap) throw new VerifyError('This link is invalid. Ask for a new verification email.');
  const data = tokenSnap.data();
  if (data.used) throw new VerifyError('This link has already been used.');
  if (data.expiresAt.toDate() < new Date()) throw new VerifyError('This link has expired. Ask for a new verification email.');
  if (!PROMPTS[data.type]) throw new VerifyError('This link is invalid.');
  return data;
}

export function createVerifyRouter({ db, auth }) {
  const router = express.Router();
  const tokenQuery = (token) =>
    db.collection('verification_tokens').where('hashedToken', '==', hashToken(token)).limit(1);
  const readToken = (token) =>
    (typeof token === 'string' && /^[a-f0-9]{64}$/.test(token) ? token : null);

  const send = (res, status, page) => {
    // Pages carry a live token: keep them out of caches and referrers.
    res.set('Cache-Control', 'no-store');
    res.set('Referrer-Policy', 'no-referrer');
    res.status(status).send(renderPage(page));
  };
  const fail = (res, error) => {
    if (error instanceof VerifyError) {
      return send(res, 400, { title: 'Verification failed', message: error.message, tone: 'error' });
    }
    console.error('Verification error:', error);
    return send(res, 500, { title: 'Verification failed', message: 'Something went wrong on our side. Please try the link again later.', tone: 'error' });
  };

  // GET: read-only. Safe for link scanners and prefetchers to open.
  router.get('/api/verify', async (req, res) => {
    try {
      const token = readToken(req.query.token);
      if (!token) throw new VerifyError('This link is invalid. Ask for a new verification email.');
      const snap = await tokenQuery(token).get();
      const data = assertUsable(snap.docs[0]);
      const prompt = PROMPTS[data.type];
      return send(res, 200, { ...prompt, confirm: { token, label: prompt.label } });
    } catch (error) {
      return fail(res, error);
    }
  });

  // POST: the only place a verification takes effect.
  router.post('/api/verify', express.urlencoded({ extended: false, limit: '2kb' }), async (req, res) => {
    try {
      const token = readToken(req.body?.token);
      if (!token) throw new VerifyError('This link is invalid. Ask for a new verification email.');

      const outcome = await db.runTransaction(async (tx) => {
        // All reads first (a Firestore transaction requirement), then writes.
        const tokenSnap = (await tx.get(tokenQuery(token))).docs[0];
        const data = assertUsable(tokenSnap);
        const auditRef = db.collection('audit_logs').doc();

        if (data.type === 'onboarding') {
          const userRef = db.collection('users').doc(data.email);
          const userSnap = await tx.get(userRef);
          if (!userSnap.exists) throw new VerifyError('Your account could not be found. Please contact a team admin.');

          tx.update(userRef, { status: 'active', emailVerified: true });
          tx.update(tokenSnap.ref, { used: true, verifiedAt: new Date() });
          tx.create(auditRef, buildAuditEntry({ category: 'account', action: 'email_verified', actor: data.email }));
          return { type: 'onboarding' };
        }

        // Migration
        const oldEmail = String(data.metadata?.oldEmail || '').toLowerCase();
        const newEmail = data.email;
        if (!oldEmail) throw new VerifyError('This link is invalid.');

        const oldUserRef = db.collection('users').doc(oldEmail);
        const newUserRef = db.collection('users').doc(newEmail);
        const oldAdminRef = db.collection('admins').doc(oldEmail);
        const newAdminRef = db.collection('admins').doc(newEmail);
        const [oldUserSnap, newUserSnap, oldAdminSnap, teamSnap] = await Promise.all([
          tx.get(oldUserRef),
          tx.get(newUserRef),
          tx.get(oldAdminRef),
          tx.get(db.collection('team_members').where('userId', '==', oldEmail)),
        ]);
        if (!oldUserSnap.exists) throw new VerifyError('The original account was not found, or it has already been migrated.');
        // Never overwrite an account created at the new address after the request.
        if (newUserSnap.exists) throw new VerifyError('An account already exists for this email address, so the migration was stopped. Please contact a team admin.');

        tx.create(newUserRef, { ...oldUserSnap.data(), email: newEmail });
        teamSnap.docs.forEach((memberDoc) => tx.update(memberDoc.ref, { userId: newEmail }));

        let hasAdmin = false;
        let hasSuperAdmin = false;
        if (oldAdminSnap.exists) {
          const adminData = oldAdminSnap.data();
          tx.set(newAdminRef, { ...adminData, email: newEmail });
          tx.delete(oldAdminRef);
          hasAdmin = true;
          hasSuperAdmin = adminData.isRoot || adminData.isSuperAdmin || false;
        }

        tx.delete(oldUserRef);
        tx.update(tokenSnap.ref, { used: true, verifiedAt: new Date() });
        tx.create(auditRef, buildAuditEntry({ category: 'account', action: 'email_migrated', actor: oldEmail, target: newEmail }));
        return { type: 'migration', oldEmail, newEmail, hasAdmin, hasSuperAdmin };
      });

      if (outcome.type === 'onboarding') {
        return send(res, 200, { title: 'Email verified', message: 'Your account is now active. You can return to the app and sign in.', tone: 'ok' });
      }

      // Firebase Auth can't join a Firestore transaction, so claims move after
      // the data has committed. Failures here are logged for a super admin to
      // fix; the data migration itself is already complete and consistent.
      await migrateAuthClaims(auth, outcome);
      return send(res, 200, { title: 'Email migration complete', message: 'Your account has been moved. Please sign in with your new Google account.', tone: 'ok' });
    } catch (error) {
      return fail(res, error);
    }
  });

  return router;
}

async function migrateAuthClaims(auth, { oldEmail, newEmail, hasAdmin, hasSuperAdmin }) {
  try {
    let newAuthUser;
    try {
      newAuthUser = await auth.getUserByEmail(newEmail);
    } catch (e) {
      if (e.code !== 'auth/user-not-found') throw e;
      newAuthUser = await auth.createUser({ email: newEmail });
    }
    await updateRoleClaims(auth, newAuthUser, { admin: hasAdmin, superAdmin: hasSuperAdmin });
  } catch (error) {
    console.error(`[Migration] Could not move claims to ${newEmail}:`, error);
  }

  try {
    const oldAuthUser = await auth.getUserByEmail(oldEmail);
    await updateRoleClaims(auth, oldAuthUser, { admin: false, superAdmin: false });
    // Sign the old account out everywhere so its existing session can't keep
    // using admin rights that now belong to the new address.
    await auth.revokeRefreshTokens(oldAuthUser.uid);
  } catch (error) {
    if (error.code !== 'auth/user-not-found') {
      console.error(`[Migration] Could not clear claims on ${oldEmail}:`, error);
    }
  }
}
