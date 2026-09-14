import type { VercelRequest } from '@vercel/node';
import jwt from 'jsonwebtoken';
import { kv } from './kv';

// Replaces the old in-memory `Set<string>` session store (vite-plugins/dashboardAuthPlugin.ts) —
// a serverless function has no memory shared across invocations, so sessions are now stateless
// signed JWTs (verifiable without any storage) plus a small KV "revoked" blocklist for logout,
// since a JWT can't otherwise be invalidated before its own expiry.
const TOKEN_TTL = '12h';
const TOKEN_TTL_SECONDS = 12 * 60 * 60;

export interface JwtClaims extends jwt.JwtPayload {
  jti: string;
}

function requireSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not set');
  return secret;
}

export function signSessionToken(jti: string): string {
  return jwt.sign({ jti }, requireSecret(), { expiresIn: TOKEN_TTL });
}

export const SESSION_TOKEN_TTL_SECONDS = TOKEN_TTL_SECONDS;

function tokenFromRequest(req: VercelRequest): string {
  const header = req.headers.authorization;
  const value = Array.isArray(header) ? header[0] : header;
  return (value || '').replace(/^Bearer\s+/i, '');
}

export type AuthResult = { ok: true } | { ok: false; status: number; body: { ok: false; error: string } };

const UNAUTHORIZED: AuthResult = { ok: false, status: 401, body: { ok: false, error: 'Not authenticated' } };

// Every protected handler calls this first. Verifies the Bearer token's signature/expiry (a
// forged or expired token is rejected without ever touching KV), then checks the `revoked:<jti>`
// blocklist so an explicit logout takes effect immediately rather than waiting out the token's
// remaining 12h lifetime. Returns the exact same 401 `{ok:false,error:'Not authenticated'}` shape
// the old in-memory gate used, so the frontend's existing 401-triggers-logout handling (see
// src/auth.ts's fetch interceptor) needs no changes.
export async function requireAuth(req: VercelRequest): Promise<AuthResult> {
  const token = tokenFromRequest(req);
  if (!token) return UNAUTHORIZED;

  let claims: JwtClaims;
  try {
    claims = jwt.verify(token, requireSecret()) as JwtClaims;
  } catch {
    return UNAUTHORIZED;
  }
  if (!claims.jti) return UNAUTHORIZED;

  try {
    const revoked = await kv.get(`revoked:${claims.jti}`);
    if (revoked) return UNAUTHORIZED;
  } catch (err) {
    // Fail closed: if KV is unreachable we can't confirm the token wasn't revoked, and this
    // dashboard shows bank/UAN/salary data, so an availability blip on the KV side should not
    // silently widen into "everyone stays logged in no matter what".
    console.error('[auth] KV lookup for revocation check failed', err);
    return UNAUTHORIZED;
  }
  return { ok: true };
}

export { tokenFromRequest };
