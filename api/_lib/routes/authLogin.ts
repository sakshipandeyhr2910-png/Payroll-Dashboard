import type { VercelRequest, VercelResponse } from '@vercel/node';
import { randomBytes } from 'crypto';
import { signSessionToken } from '../auth.js';
import { readJsonBody } from '../readBody.js';

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

  // Trimmed on both sides: a trailing space/newline pasted into Vercel's env var UI is invisible
  // there but makes an otherwise-correct password never match.
  const expectedUsername = process.env.DASHBOARD_USERNAME?.trim();
  const expectedPassword = process.env.DASHBOARD_PASSWORD?.trim();
  if (!expectedUsername || !expectedPassword) {
    console.error('[auth/login] DASHBOARD_USERNAME / DASHBOARD_PASSWORD is not set');
    res.status(500).json({
      ok: false,
      error: 'Server misconfigured: DASHBOARD_USERNAME / DASHBOARD_PASSWORD are not set in this environment',
    });
    return;
  }

  const { username, password } = parsed;
  if (username?.trim() !== expectedUsername || password?.trim() !== expectedPassword) {
    res.status(401).json({ ok: false, error: 'Invalid username or password' });
    return;
  }

  if (!process.env.JWT_SECRET) {
    console.error('[auth/login] JWT_SECRET is not set');
    res.status(500).json({ ok: false, error: 'Server misconfigured' });
    return;
  }

  const jti = randomBytes(16).toString('hex');
  const token = signSessionToken(jti, { role: 'hr' });
  res.status(200).json({ ok: true, token, role: 'hr' });
}
