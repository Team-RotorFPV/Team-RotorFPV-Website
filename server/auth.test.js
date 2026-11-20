// Smoke tests for the auth middleware + request helpers (server/auth.js).
// Run with: npm test  (uses Node's built-in test runner — no extra deps).
// These cover the offline-verifiable paths: the no-token / malformed-header
// guards (which short-circuit before Firebase is ever called) and the pure
// IP / Cloudinary-URL helpers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyAdmin, verifySuperAdmin, isSuperAdminToken, getClientIp, getPublicIdFromUrl, isActiveMember, requireActiveMember, updateRoleClaims } from './auth.js';

// Fake Admin Auth that records the claims object actually written.
const claimsRecorder = () => {
  const writes = [];
  return { writes, setCustomUserClaims: async (uid, claims) => { writes.push({ uid, claims }); } };
};

test('updateRoleClaims keeps unrelated claims when granting admin', async () => {
  const auth = claimsRecorder();
  const user = { uid: 'u1', customClaims: { inventory: true, board: true, media: true } };
  await updateRoleClaims(auth, user, { admin: true, superAdmin: false });
  assert.deepEqual(auth.writes, [{ uid: 'u1', claims: { inventory: true, board: true, media: true, admin: true, superAdmin: false } }]);
});

test('updateRoleClaims keeps inventory access when admin is revoked', async () => {
  const auth = claimsRecorder();
  const user = { uid: 'u2', customClaims: { admin: true, superAdmin: true, inventory: true } };
  await updateRoleClaims(auth, user, { admin: false, superAdmin: false });
  assert.deepEqual(auth.writes[0].claims, { admin: false, superAdmin: false, inventory: true });
});

test('updateRoleClaims works for a brand-new user with no claims yet', async () => {
  const auth = claimsRecorder();
  await updateRoleClaims(auth, { uid: 'u3' }, { admin: true, superAdmin: true });
  assert.deepEqual(auth.writes[0].claims, { admin: true, superAdmin: true });
});

function mockRes() {
  return {
    statusCode: undefined,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(obj) { this.body = obj; return this; },
  };
}

test('verifyAdmin rejects a request with no Authorization header (401)', async () => {
  const res = mockRes();
  let nextCalled = false;
  await verifyAdmin({ headers: {} }, res, () => { nextCalled = true; });
  assert.equal(res.statusCode, 401);
  assert.equal(nextCalled, false);
});

test('verifyAdmin rejects a non-Bearer Authorization header (401)', async () => {
  const res = mockRes();
  let nextCalled = false;
  await verifyAdmin({ headers: { authorization: 'Basic Zm9v' } }, res, () => { nextCalled = true; });
  assert.equal(res.statusCode, 401);
  assert.equal(nextCalled, false);
});

test('verifySuperAdmin rejects a request with no Authorization header (401)', async () => {
  const res = mockRes();
  let nextCalled = false;
  await verifySuperAdmin({ headers: {} }, res, () => { nextCalled = true; });
  assert.equal(res.statusCode, 401);
  assert.equal(nextCalled, false);
});

// A request as Render delivers it: the edge appends the real client, then a
// varying number of private internal hops.
const viaRender = (xff, extraHeaders = {}) => ({
  headers: { 'x-forwarded-for': xff, ...extraHeaders },
  socket: { remoteAddress: '10.0.0.9' },
  ip: xff.split(',')[0].trim(), // what Express's req.ip would (wrongly) report
});

test('getClientIp skips private internal hops to find the real client', () => {
  assert.equal(getClientIp(viaRender('203.0.113.7, 10.0.0.1, 10.0.0.2')), '203.0.113.7');
  assert.equal(getClientIp(viaRender('203.0.113.7, 10.1.2.3')), '203.0.113.7');
});

test('getClientIp ignores forged entries the client prepended to X-Forwarded-For', () => {
  // Attacker sent "X-Forwarded-For: 198.51.100.1"; Render appended the real IP.
  const req = viaRender('198.51.100.1, 203.0.113.7, 10.0.0.1');
  assert.equal(getClientIp(req), '203.0.113.7');
});

test('getClientIp gives a stable key when the forged IP changes every request', () => {
  const keys = new Set();
  for (let i = 1; i <= 50; i += 1) {
    keys.add(getClientIp(viaRender(`198.51.100.${i}, 203.0.113.7, 10.0.0.1`)));
  }
  assert.deepEqual([...keys], ['203.0.113.7']);
});

test('getClientIp ignores client-settable real-IP headers', () => {
  const req = viaRender('203.0.113.7, 10.0.0.1', {
    'x-real-ip': '198.51.100.5',
    'cf-connecting-ip': '198.51.100.6',
    'true-client-ip': '198.51.100.7',
    'fly-client-ip': '198.51.100.8',
  });
  assert.equal(getClientIp(req), '203.0.113.7');
});

test('getClientIp ignores junk and private values forged into the chain', () => {
  assert.equal(getClientIp(viaRender('not-an-ip, 203.0.113.7, 100.64.0.1, 10.0.0.1')), '203.0.113.7');
});

test('getClientIp falls back to the socket address, never the forgeable req.ip', () => {
  const req = { headers: {}, socket: { remoteAddress: '::ffff:192.0.2.50' }, ip: '198.51.100.99' };
  assert.equal(getClientIp(req), '192.0.2.50');
});

test('isActiveMember accepts active and legacy (no status) members', () => {
  assert.equal(isActiveMember({ status: 'active' }), true);
  assert.equal(isActiveMember({ name: 'Legacy member' }), true);
  assert.equal(isActiveMember({ status: 'active', isActive: true, isArchived: false }), true);
});

test('isActiveMember rejects missing, archived, deactivated and unverified users', () => {
  assert.equal(isActiveMember(null), false);
  assert.equal(isActiveMember({ status: 'active', isArchived: true }), false);
  assert.equal(isActiveMember({ status: 'active', isActive: false }), false);
  assert.equal(isActiveMember({ status: 'approved_unverified' }), false);
  assert.equal(isActiveMember({ status: 'pending' }), false);
});

// Runs the middleware and reports whether it let the request through.
async function runUploaderGate(user, users = {}) {
  const res = mockRes();
  let nextCalled = false;
  const loadUser = async (email) => users[email] ?? null;
  await requireActiveMember(loadUser)({ user }, res, () => { nextCalled = true; });
  return { allowed: nextCalled, status: res.statusCode };
}

test('requireActiveMember blocks a random Google account with no users doc', async () => {
  const result = await runUploaderGate({ uid: 'x', email: 'stranger@gmail.com', email_verified: true });
  assert.deepEqual(result, { allowed: false, status: 403 });
});

test('requireActiveMember lets an active member through (email matched case-insensitively)', async () => {
  const result = await runUploaderGate(
    { uid: 'm', email: 'Member@VIT.ac.in', email_verified: true },
    { 'member@vit.ac.in': { status: 'active' } },
  );
  assert.equal(result.allowed, true);
});

test('requireActiveMember blocks archived and not-yet-verified members', async () => {
  const archived = await runUploaderGate(
    { uid: 'a', email: 'old@vit.ac.in', email_verified: true },
    { 'old@vit.ac.in': { status: 'active', isArchived: true } },
  );
  const pending = await runUploaderGate(
    { uid: 'p', email: 'new@vit.ac.in', email_verified: true },
    { 'new@vit.ac.in': { status: 'approved_unverified' } },
  );
  assert.equal(archived.status, 403);
  assert.equal(pending.status, 403);
});

test('requireActiveMember blocks an unverified email even if it matches a member', async () => {
  const result = await runUploaderGate(
    { uid: 'u', email: 'member@vit.ac.in', email_verified: false },
    { 'member@vit.ac.in': { status: 'active' } },
  );
  assert.deepEqual(result, { allowed: false, status: 403 });
});

test('requireActiveMember always lets admins through without a lookup', async () => {
  let looked = false;
  const res = mockRes();
  let nextCalled = false;
  await requireActiveMember(async () => { looked = true; return null; })(
    { user: { uid: 'adm', email: 'admin@vit.ac.in', admin: true } }, res, () => { nextCalled = true; },
  );
  assert.equal(nextCalled, true);
  assert.equal(looked, false);
});

test('requireActiveMember fails closed (500) if the membership lookup errors', async () => {
  const res = mockRes();
  let nextCalled = false;
  const origError = console.error;
  console.error = () => {};
  try {
    await requireActiveMember(async () => { throw new Error('firestore down'); })(
      { user: { uid: 'm', email: 'member@vit.ac.in', email_verified: true } }, res, () => { nextCalled = true; },
    );
  } finally {
    console.error = origError;
  }
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 500);
});

test('getPublicIdFromUrl derives the id from an optimized Cloudinary URL', () => {
  const url = 'https://res.cloudinary.com/demo/image/upload/c_limit,w_1200,f_auto,q_auto/v1700000000/team-rotor/abc.jpg';
  assert.equal(getPublicIdFromUrl(url), 'team-rotor/abc');
});

test('getPublicIdFromUrl returns null for non-Cloudinary URLs', () => {
  assert.equal(getPublicIdFromUrl('https://example.com/foo.png'), null);
});

test('isSuperAdminToken: claim always counts; the root email only when verified', () => {
  const root = 'root@vit.ac.in';
  assert.equal(isSuperAdminToken({ superAdmin: true }, root), true);
  assert.equal(isSuperAdminToken({ email: 'Root@VIT.ac.in', email_verified: true }, root), true);
  // e.g. an email/password account registered under the root address
  assert.equal(isSuperAdminToken({ email: root, email_verified: false }, root), false);
  assert.equal(isSuperAdminToken({ email: root }, root), false);
  assert.equal(isSuperAdminToken({ email: 'other@vit.ac.in', email_verified: true }, root), false);
  assert.equal(isSuperAdminToken({ email: '', email_verified: true }, ''), false);
});
