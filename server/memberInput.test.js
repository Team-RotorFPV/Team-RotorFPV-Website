// Tests for server/memberInput.js. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InputError, parseEmail, parseApproveRequest, parseCreateMember } from './memberInput.js';

test('emails are trimmed and lowercased; junk and path tricks are rejected', () => {
  assert.equal(parseEmail('  New.Member@VIT.ac.in '), 'new.member@vit.ac.in');
  for (const bad of [undefined, '', 42, ['a@b.co'], 'no-at-sign', 'a@b', 'a/b@c.co', 'a@b.co/../admins']) {
    assert.throws(() => parseEmail(bad), InputError, String(bad));
  }
});

test('approve with no email is a 400-style InputError, not a TypeError', () => {
  assert.throws(() => parseApproveRequest({ requestId: 'abc123' }), InputError);
  assert.throws(() => parseApproveRequest({ email: 'a@b.co' }), InputError);
  assert.throws(() => parseApproveRequest({ requestId: '../users/x', email: 'a@b.co' }), InputError);
});

test('approve returns clean, defaulted values', () => {
  assert.deepEqual(parseApproveRequest({ requestId: 'r1', email: 'A@B.co', name: ' Asha ', tags: ['t1', 't1'], extra: 'ignored' }), {
    requestId: 'r1', name: 'Asha', email: 'a@b.co', tags: ['t1'], customFields: {},
  });
});

test('tags and customFields must have the expected shape', () => {
  assert.throws(() => parseCreateMember({ email: 'a@b.co', tags: 'superadmin' }), InputError);
  assert.throws(() => parseCreateMember({ email: 'a@b.co', tags: [{ id: 'x' }] }), InputError);
  assert.throws(() => parseCreateMember({ email: 'a@b.co', customFields: ['x'] }), InputError);
  assert.throws(() => parseCreateMember({ email: 'a@b.co', customFields: { f1: { nested: true } } }), InputError);
  assert.throws(() => parseCreateMember({ email: 'a@b.co', customFields: { f1: 'x'.repeat(1001) } }), InputError);
  assert.deepEqual(
    parseCreateMember({ email: 'a@b.co', tags: ['t1'], customFields: { f1: 'Mech', f2: 3, f3: true, f4: null } }),
    { email: 'a@b.co', tags: ['t1'], customFields: { f1: 'Mech', f2: 3, f3: true, f4: null } },
  );
});
