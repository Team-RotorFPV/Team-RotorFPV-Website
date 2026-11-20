// Tests for server/visitPrivacy.js. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { visitorHashSecret, visitorId, visitExpiry, VISIT_RETENTION_DAYS } from './visitPrivacy.js';

test('visitorId is stable per IP, differs across IPs and secrets, and hides the IP', () => {
  const a = visitorId('203.0.113.7', 's1');
  assert.equal(a, visitorId('203.0.113.7', 's1'));
  assert.notEqual(a, visitorId('203.0.113.8', 's1'));
  assert.notEqual(a, visitorId('203.0.113.7', 's2'));
  assert.match(a, /^[0-9a-f]{16}$/);
  assert.ok(!a.includes('203'));
  assert.equal(visitorId('', 's1'), null);
});

test('secret comes from the env var, else from the service account key', () => {
  assert.equal(visitorHashSecret({ VISITOR_HASH_SECRET: 'x' }, { private_key: 'k' }), 'x');
  const derived = visitorHashSecret({}, { private_key: 'k' });
  assert.equal(derived, visitorHashSecret({}, { private_key: 'k' }));
  assert.notEqual(derived, 'k');
  assert.throws(() => visitorHashSecret({}, null));
});

test('visits expire after the retention period', () => {
  const now = new Date('2026-01-01T00:00:00Z');
  assert.equal(visitExpiry(now).getTime() - now.getTime(), VISIT_RETENTION_DAYS * 86400000);
});
