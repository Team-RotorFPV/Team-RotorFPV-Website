import crypto from 'node:crypto';

// SHA-256 of a raw verification token. Only the hash is stored in
// verification_tokens, so a leaked collection can't be replayed as links.
// Shared by verificationService.js (issuing) and verifyFlow.js (checking).
export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}
