// Privacy for the `visits` collection (the admin Traffic tab).
//
// Visits used to store each visitor's raw IP plus geoip latitude/longitude,
// kept forever. IPs are personal data under India's DPDP Act, and the Traffic
// tab only needs to count unique visitors, so:
//   - the IP is replaced by a keyed hash (same visitor -> same ID, but the ID
//     can't be turned back into an IP without the server's secret);
//   - coordinates are not stored at all (country/region/city stay);
//   - every visit gets an `expireAt` date for a Firestore TTL policy.
import { createHash, createHmac } from 'node:crypto';

export const VISIT_RETENTION_DAYS = 180;

// The HMAC key. Prefer a dedicated env var; otherwise derive a stable secret
// from the service account key, which the server always has and never ships.
export function visitorHashSecret(env = process.env, serviceAccount = null) {
  if (env.VISITOR_HASH_SECRET) return env.VISITOR_HASH_SECRET;
  if (serviceAccount?.private_key) {
    return createHash('sha256').update(`visitor-id:${serviceAccount.private_key}`).digest('hex');
  }
  throw new Error('Set VISITOR_HASH_SECRET to hash visitor IPs');
}

// Pseudonymous visitor ID for an IP. 16 hex chars is plenty to count uniques.
export function visitorId(ip, secret) {
  if (!ip) return null;
  return createHmac('sha256', secret).update(String(ip)).digest('hex').slice(0, 16);
}

export function visitExpiry(now = new Date()) {
  return new Date(now.getTime() + VISIT_RETENTION_DAYS * 24 * 60 * 60 * 1000);
}
