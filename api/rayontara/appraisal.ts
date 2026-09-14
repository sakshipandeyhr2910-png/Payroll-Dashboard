import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuth } from '../_lib/auth';
import { RAYONTARA_EMP_CODES } from '../_lib/rayontaraEmpCodes';
import { fetchAppraisalPlainWithRetry, type AppraisalCredentials } from '../_lib/appraisalClient';
import { safeVerifyKoenigDecryption } from '../_lib/koenigDecryption';

function credsFromEnv(): AppraisalCredentials {
  return {
    base: process.env.APPRAISAL_API_BASE || '',
    username: process.env.APPRAISAL_USERNAME || '',
    password: process.env.APPRAISAL_PASSWORD || '',
    role: process.env.APPRAISAL_ROLE || '',
    apiKey: process.env.APPRAISAL_API_KEY || '',
    decryptPassword: process.env.KITES_DECRYPT_PASSWORD || '',
    decryptSalt: process.env.KITES_DECRYPT_SALT || '',
  };
}

// Ported from vite-plugins/rayontaraAppraisalApiPlugin.ts's '/api/rayontara/appraisal' handler.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await requireAuth(req);
  if (!auth.ok) {
    res.status(auth.status).json(auth.body);
    return;
  }

  const creds = credsFromEnv();
  safeVerifyKoenigDecryption(creds.decryptPassword, creds.decryptSalt);

  try {
    const records = await fetchAppraisalPlainWithRetry(creds, RAYONTARA_EMP_CODES);
    res.status(200).json({ ok: true, records });
  } catch (err) {
    console.error('[rayontara-appraisal-api]', err);
    const message = err instanceof Error ? err.message : 'Unknown error contacting Appraisal API';
    res.status(502).json({ ok: false, error: message });
  }
}
