import crypto from 'node:crypto';

// Constant-time check of the `x-admin-key` header against ADMIN_KEY.
// Returns null when the key is not configured, else true / false.
// (api/scores-admin.js and api/content.js carry their own copy of this.)
export function keyValid(provided) {
  const expected = process.env.ADMIN_KEY;
  if (!expected) return null;
  const a = crypto.createHash('sha256').update(String(provided || '')).digest();
  const b = crypto.createHash('sha256').update(String(expected)).digest();
  return crypto.timingSafeEqual(a, b);
}
