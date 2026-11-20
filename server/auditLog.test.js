// Tests for the audit log writer/reader (server/auditLog.js).
// Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAuditEntry, formatAuditLog, toIso } from './auditLog.js';

const T = '2026-03-01T10:00:00.000Z';
const ts = { toDate: () => new Date(T) }; // stands in for a Firestore Timestamp

test('buildAuditEntry writes one shape with a real Date timestamp', () => {
  const entry = buildAuditEntry({ category: 'onboarding', action: 'join_request_approved', actor: 'boss@vit.ac.in', target: 'new@vit.ac.in' });
  assert.equal(entry.category, 'onboarding');
  assert.equal(entry.userEmail, 'boss@vit.ac.in');
  assert.equal(entry.targetEmail, 'new@vit.ac.in');
  assert.ok(entry.timestamp instanceof Date);
  assert.equal(entry.actor, undefined);
});

test('buildAuditEntry rejects unknown categories and missing actors', () => {
  assert.throws(() => buildAuditEntry({ category: 'misc', action: 'x', actor: 'a@b.c' }));
  assert.throws(() => buildAuditEntry({ category: 'account', action: 'x' }));
});

test('new onboarding entries show who approved whom (was "undefined" / INVENTORY_UPDATE)', () => {
  const row = formatAuditLog('a1', { category: 'onboarding', action: 'join_request_approved', userEmail: 'boss@vit.ac.in', targetEmail: 'new@vit.ac.in', timestamp: ts });
  assert.deepEqual(row, {
    id: 'a1', type: 'audit', timestamp: T, user: 'boss@vit.ac.in',
    action: 'JOIN_REQUEST_APPROVED', target: 'new@vit.ac.in',
    details: 'approved the join request from new@vit.ac.in',
  });
});

test('old { actor, target } entries already in Firestore now display correctly', () => {
  const row = formatAuditLog('a2', { action: 'team_member_created', actor: 'boss@vit.ac.in', target: 'kid@vit.ac.in', timestamp: T });
  assert.equal(row.user, 'boss@vit.ac.in');
  assert.equal(row.action, 'TEAM_MEMBER_CREATED');
  assert.equal(row.details, 'created team member kid@vit.ac.in');
  assert.equal(row.timestamp, T);
});

test('self-only account events read naturally', () => {
  const row = formatAuditLog('a3', { category: 'account', action: 'email_verified', userEmail: 'me@vit.ac.in', targetEmail: null, timestamp: ts });
  assert.equal(row.details, 'verified their email');
  assert.equal(row.target, 'me@vit.ac.in');
  const migrated = formatAuditLog('a4', { category: 'account', action: 'email_migrated', userEmail: 'old@vit.ac.in', targetEmail: 'new@vit.ac.in', timestamp: ts });
  assert.equal(migrated.details, 'moved their account to new@vit.ac.in');
});

test('role changes, both new and legacy, show as ROLE_CHANGE', () => {
  const fresh = formatAuditLog('r1', { category: 'role_change', action: 'granted admin to', userEmail: 'boss@vit.ac.in', targetEmail: 'x@vit.ac.in', timestamp: ts });
  const legacy = formatAuditLog('r2', { action: 'granted admin to', userEmail: 'boss@vit.ac.in', targetEmail: 'x@vit.ac.in', timestamp: ts });
  for (const row of [fresh, legacy]) {
    assert.equal(row.action, 'ROLE_CHANGE');
    assert.equal(row.details, 'granted admin to x@vit.ac.in');
    assert.equal(row.user, 'boss@vit.ac.in');
  }
});

test('inventory app entries still show as INVENTORY_UPDATE', () => {
  const row = formatAuditLog('i1', { action: 'item_moved', userEmail: 'crew@vit.ac.in', newValue: 'Shelf B', timestamp: ts });
  assert.equal(row.action, 'INVENTORY_UPDATE');
  assert.equal(row.details, 'item_moved to Shelf B');
});

test('toIso handles Timestamps, Dates, strings and junk without throwing', () => {
  assert.equal(toIso(ts), T);
  assert.equal(toIso(new Date(T)), T);
  assert.equal(toIso(T), T);
  assert.equal(toIso('not a date'), null);
  assert.equal(toIso(undefined), null);
});
