import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuth } from '../auth.js';
import { RAYONTARA_EMP_CODES } from '../rayontaraEmpCodes.js';
import { fetchArrearForCodesWithRetry, type ArrearCredentials } from '../arrearClient.js';
import { safeVerifyKoenigDecryption } from '../koenigDecryption.js';

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

// Ported from vite-plugins/rayontaraArrearApiPlugin.ts's '/api/rayontara/arrear' handler.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await requireAuth(req);
  if (!auth.ok) {
    res.status(auth.status).json(auth.body);
    return;
  }

  const creds = credsFromEnv();
  safeVerifyKoenigDecryption(creds.decryptPassword, creds.decryptSalt);

  try {
    const records = await fetchArrearForCodesWithRetry(creds, RAYONTARA_EMP_CODES);
    res.status(200).json({ ok: true, records });
  } catch (err) {
    console.error('[rayontara-arrear-api]', err);
    const message = err instanceof Error ? err.message : 'Unknown error contacting GetLastTwoAppraisals API';
    res.status(502).json({ ok: false, error: message });
  }
}
