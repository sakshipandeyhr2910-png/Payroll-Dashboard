import type { VercelRequest, VercelResponse } from '@vercel/node';
import jwt from 'jsonwebtoken';
import { tokenFromRequest } from '../auth.js';
import { kv } from '../kv.js';

// Ported from vite-plugins/dashboardAuthPlugin.ts's '/api/auth/logout' handler. The old version
// just deleted the token from the in-memory `validTokens` Set. A JWT can't be un-signed, so
// instead this adds the token's `jti` to a KV blocklist key `revoked:<jti>` — requireAuth (see
// api/_lib/auth.ts) checks that key on every request — with a TTL equal to the token's own
// remaining time-to-expiry, so the blocklist entry never needs to be cleaned up separately: once
// the token would have expired naturally, the KV key expires with it.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Method not allowed' });
    return;
  }

  const token = tokenFromRequest(req);
  const secret = process.env.JWT_SECRET;
  if (token && secret) {
    try {
      const claims = jwt.verify(token, secret) as jwt.JwtPayload;
      if (claims.jti && typeof claims.exp === 'number') {
        const ttlSeconds = claims.exp - Math.floor(Date.now() / 1000);
        if (ttlSeconds > 0) {
          await kv.set(`revoked:${claims.jti}`, true, { ex: ttlSeconds });
        }
      }
    } catch (err) {
      // Invalid, malformed, or already-expired token — nothing to revoke (matches the old
      // plugin's defensive `validTokens.delete(...)`, which was also a silent no-op for a token
      // it didn't recognize). Still logged since a KV write failure here would otherwise be silent.
      console.error('[auth/logout] could not revoke token (already invalid/expired, or KV error)', err);
    }
  }
  res.status(200).json({ ok: true });
}
