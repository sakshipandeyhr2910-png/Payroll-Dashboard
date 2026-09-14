import type { VercelRequest, VercelResponse } from '@vercel/node';
import { randomBytes } from 'crypto';
import { signSessionToken } from '../_lib/auth';
import { readJsonBody } from '../_lib/readBody';

// Ported from vite-plugins/dashboardAuthPlugin.ts's '/api/auth/login' handler. Same single shared
// login for the whole dashboard (not per-user accounts) — still validated against
// DASHBOARD_USERNAME/DASHBOARD_PASSWORD — but the issued token is now a signed JWT (see
// api/_lib/auth.ts) instead of a random string tracked in an in-memory Set, since a Vercel
// function has no long-lived process to hold that Set in.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Method not allowed' });
    return;
  }

  const parsed = readJsonBody<{ username?: string; password?: string }>(req);
  if (parsed === null) {
    res.status(400).json({ ok: false, error: 'Invalid request' });
    return;
  }

  const { username, password } = parsed;
  if (username !== process.env.DASHBOARD_USERNAME || password !== process.env.DASHBOARD_PASSWORD) {
    res.status(401).json({ ok: false, error: 'Invalid username or password' });
    return;
  }

  if (!process.env.JWT_SECRET) {
    console.error('[auth/login] JWT_SECRET is not set');
    res.status(500).json({ ok: false, error: 'Server misconfigured' });
    return;
  }

  const jti = randomBytes(16).toString('hex');
  const token = signSessionToken(jti);
  res.status(200).json({ ok: true, token });
}
