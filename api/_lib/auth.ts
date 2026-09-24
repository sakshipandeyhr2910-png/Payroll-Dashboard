import type { VercelRequest } from '@vercel/node';
import jwt from 'jsonwebtoken';
import { kv } from './kv.js';

// Replaces the old in-memory `Set<string>` session store (vite-plugins/dashboardAuthPlugin.ts) —
// a serverless function has no memory shared across invocations, so sessions are now stateless
// signed JWTs (verifiable without any storage) plus a small KV "revoked" blocklist for logout,
// since a JWT can't otherwise be invalidated before its own expiry.
const TOKEN_TTL = '12h';
const TOKEN_TTL_SECONDS = 12 * 60 * 60;

// A session is either the single shared HR Admin login (full access to every existing bulk
// route) or one employee's session, scoped to exactly their own Emp Code/entity — minted only
// after OTP verification (api/_lib/routes/employeeAuthVerifyOtp.ts), never here. The employee
// variant's fields are signed into the JWT itself, so /api/employee/* handlers can derive "whose
// data is this" from the verified token alone — never from a query param or request body, which
// is what actually prevents one employee from ever requesting another's payroll data.
export type SessionClaims =
  | { role: 'hr' }
  | { role: 'employee'; empCode: number; entitySlug: string; name: string; email: string | null };

export interface JwtClaims extends jwt.JwtPayload {
  jti: string;
  session: SessionClaims;
}

function requireSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not set');
  return secret;
}

export function signSessionToken(jti: string, session: SessionClaims): string {
  return jwt.sign({ jti, session }, requireSecret(), { expiresIn: TOKEN_TTL });
}

export const SESSION_TOKEN_TTL_SECONDS = TOKEN_TTL_SECONDS;

function tokenFromRequest(req: VercelRequest): string {
  const header = req.headers.authorization;
  const value = Array.isArray(header) ? header[0] : header;
  return (value || '').replace(/^Bearer\s+/i, '');
}

export type AuthResult =
  | { ok: true; claims: SessionClaims }
  | { ok: false; status: number; body: { ok: false; error: string } };

const UNAUTHORIZED: AuthResult = { ok: false, status: 401, body: { ok: false, error: 'Not authenticated' } };
const FORBIDDEN: AuthResult = { ok: false, status: 403, body: { ok: false, error: 'Forbidden' } };

// Every protected handler calls this first. Verifies the Bearer token's signature/expiry (a
// forged or expired token is rejected without ever touching KV), checks the `revoked:<jti>`
// blocklist so an explicit logout takes effect immediately rather than waiting out the token's
// remaining 12h lifetime, and — critically — checks the session's own role against what this
// route requires.
//
// `requiredRole` defaults to 'hr' so every one of this codebase's existing `requireAuth(req)`
// call sites (every Koenig/Rayontara/Global/Overseas/snapshot handler, none of which pass a
// second argument) automatically now reject an authenticated 'employee' session with 403 instead
// of silently letting it through — that gap (an employee token being just as valid as HR's on
// every bulk endpoint, including bank accounts and every other employee's salary) is the actual
// security boundary this whole claims model exists to close. Only the new /api/employee/* handler
// passes 'employee' explicitly.
export async function requireAuth(req: VercelRequest, requiredRole: SessionClaims['role'] = 'hr'): Promise<AuthResult> {
  const token = tokenFromRequest(req);
  if (!token) return UNAUTHORIZED;

  let claims: JwtClaims;
  try {
    claims = jwt.verify(token, requireSecret()) as JwtClaims;
  } catch {
    return UNAUTHORIZED;
  }
  if (!claims.jti || !claims.session) return UNAUTHORIZED;

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

  if (claims.session.role !== requiredRole) return FORBIDDEN;
  return { ok: true, claims: claims.session };
}

export { tokenFromRequest };
