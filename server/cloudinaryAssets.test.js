// Tests for server/cloudinaryAssets.js. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeFolder, normalizeMoveFolder, parseCloudinaryUrl, optimizedDeliveryUrl } from './cloudinaryAssets.js';

const BASE = 'https://res.cloudinary.com/demo';

test('move folders are sanitised and cannot climb out of team-rotor/', () => {
  assert.equal(normalizeMoveFolder('events/Drone-Race'), 'events/Drone-Race');
  assert.equal(normalizeMoveFolder('../../other-app/secret'), 'other-app/secret');
  assert.equal(normalizeMoveFolder('/events//past/'), 'events/past');
  assert.equal(normalizeMoveFolder('<script>'), 'script');
  assert.equal(normalizeMoveFolder('...'), null);
  assert.equal(normalizeMoveFolder({ $gt: '' }), null);
  assert.equal(sanitizeFolder(['a']), '');
});

test('image URLs (optimised or not) give the image public ID without extension', () => {
  const plain = parseCloudinaryUrl(`${BASE}/image/upload/v1712/team-rotor/events/x/photo_ab12.jpg`);
  const optimised = parseCloudinaryUrl(`${BASE}/image/upload/c_limit,w_1200,f_auto,q_auto/v1712/team-rotor/events/x/photo_ab12.jpg`);
  for (const parsed of [plain, optimised]) {
    assert.deepEqual(parsed, { resourceType: 'image', publicId: 'team-rotor/events/x/photo_ab12' });
  }
});

test('video and raw URLs keep their real resource type; raw keeps the extension', () => {
  assert.deepEqual(parseCloudinaryUrl(`${BASE}/video/upload/f_auto,q_auto:eco/v9/team-rotor/clip.mp4`), { resourceType: 'video', publicId: 'team-rotor/clip' });
  assert.deepEqual(parseCloudinaryUrl(`${BASE}/raw/upload/v9/team-rotor/docs/spec.pdf`), { resourceType: 'raw', publicId: 'team-rotor/docs/spec.pdf' });
});

test('non-Cloudinary and look-alike hosts are not parsed', () => {
  assert.equal(parseCloudinaryUrl('https://example.com/image/upload/v1/x.jpg'), null);
  assert.equal(parseCloudinaryUrl('https://res.cloudinary.com.evil.io/demo/image/upload/v1/x.jpg'), null);
  assert.equal(parseCloudinaryUrl('not a url'), null);
});

test('optimizedDeliveryUrl matches what /api/upload always returned', () => {
  assert.equal(
    optimizedDeliveryUrl({ secure_url: `${BASE}/image/upload/v1/a.jpg`, resource_type: 'image' }),
    `${BASE}/image/upload/c_limit,w_1200,f_auto,q_auto/v1/a.jpg`,
  );
  assert.equal(
    optimizedDeliveryUrl({ secure_url: `${BASE}/video/upload/v1/a.mp4`, resource_type: 'video' }),
    `${BASE}/video/upload/f_auto,q_auto:eco/v1/a.mp4`,
  );
  assert.equal(optimizedDeliveryUrl({ secure_url: `${BASE}/raw/upload/v1/a.pdf`, resource_type: 'raw' }), `${BASE}/raw/upload/v1/a.pdf`);
});
