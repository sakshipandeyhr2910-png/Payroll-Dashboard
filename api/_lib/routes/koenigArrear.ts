import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuth } from '../auth';
import { readJsonBody } from '../readBody';
import { fetchArrearForCodesWithRetry, type ArrearCredentials } from '../arrearClient';
import { safeVerifyKoenigDecryption } from '../koenigDecryption';

function credsFromEnv(): ArrearCredentials {
  return {
    base: process.env.ARREAR_API_BASE || '',
    username: process.env.ARREAR_USERNAME || '',
    password: process.env.ARREAR_PASSWORD || '',
    role: process.env.ARREAR_ROLE || '',
    apiKey: process.env.ARREAR_API_KEY || '',
    decryptPassword: process.env.KITES_DECRYPT_PASSWORD || '',
    decryptSalt: process.env.KITES_DECRYPT_SALT || '',
  };
}

// Ported from vite-plugins/rayontaraArrearApiPlugin.ts's '/api/koenig/arrear' handler. Koenig's
// codes are only known client-side (recovered by the PMS code-registry scan), so they're sent up
// in the request body, same pattern as every other Koenig-specific endpoint in this project.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await requireAuth(req);
  if (!auth.ok) {
    res.status(auth.status).json(auth.body);
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Method not allowed' });
    return;
  }

  const parsed = readJsonBody<{ codes?: unknown }>(req);
  if (parsed === null) {
    res.status(400).json({ ok: false, error: 'Invalid JSON body' });
    return;
  }
  const codes = Array.isArray(parsed.codes)
    ? parsed.codes.map(Number).filter((n: number) => Number.isFinite(n))
    : [];

  const creds = credsFromEnv();
  safeVerifyKoenigDecryption(creds.decryptPassword, creds.decryptSalt);

  try {
    const records = await fetchArrearForCodesWithRetry(creds, codes);
    res.status(200).json({ ok: true, records });
  } catch (err) {
    console.error('[koenig-arrear-api]', err);
    const message = err instanceof Error ? err.message : 'Unknown error contacting GetLastTwoAppraisals API';
    res.status(502).json({ ok: false, error: message });
  }
}
