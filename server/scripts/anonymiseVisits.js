// One-off: anonymise visits stored before visitPrivacy.js existed.
// For every visit doc with a raw `ip` or `ll`: store visitorId (keyed hash of
// the IP), delete `ip` and `ll`, and add `expireAt` for the TTL policy.
//
// Use the SAME VISITOR_HASH_SECRET as the server on Render, or old and new
// visits from one person count as two unique visitors.
//
//   VISITOR_HASH_SECRET=... node scripts/anonymiseVisits.js           # dry run
//   VISITOR_HASH_SECRET=... node scripts/anonymiseVisits.js --apply   # write
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';
import { visitorId, visitExpiry } from '../visitPrivacy.js';

const secret = process.env.VISITOR_HASH_SECRET;
if (!secret) {
  console.error('Set VISITOR_HASH_SECRET (the same value as on the server) first.');
  process.exit(1);
}
const apply = process.argv.includes('--apply');

const serviceAccount = JSON.parse(readFileSync(new URL('../serviceAccountKey.json', import.meta.url)));
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

const snap = await db.collection('visits').get();
const writer = db.bulkWriter();
let changed = 0;
for (const doc of snap.docs) {
  const v = doc.data();
  if (!('ip' in v) && !('ll' in v) && v.expireAt) continue;
  const ts = v.timestamp?.toDate ? v.timestamp.toDate() : new Date(v.timestamp || Date.now());
  changed += 1;
  if (apply) {
    writer.update(doc.ref, {
      visitorId: v.visitorId || visitorId(v.ip, secret),
      ip: FieldValue.delete(),
      ll: FieldValue.delete(),
      expireAt: v.expireAt || visitExpiry(ts),
    });
  }
}
await writer.close();
console.log(`${snap.size} visits scanned, ${changed} ${apply ? 'anonymised' : 'would be anonymised (dry run; add --apply)'}.`);
