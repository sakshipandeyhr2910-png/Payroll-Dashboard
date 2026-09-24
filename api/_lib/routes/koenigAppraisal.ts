import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuth } from '../auth.js';
import { readJsonBody } from '../readBody.js';
import { fetchAppraisalForCodesWithRetry, type AppraisalCredentials } from '../appraisalClient.js';
import { safeVerifyKoenigDecryption } from '../koenigDecryption.js';

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

// Ported from vite-plugins/rayontaraAppraisalApiPlugin.ts's '/api/koenig/appraisal' handler.
// Unlike the GET-based /api/rayontara/appraisal (a fixed, known code list needs no input from the
// browser), the Koenig code list is only known client-side (it comes from whichever employees the
// PMS code-recovery scan matched) — so this reads a JSON body of codes from the request instead.
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
    const records = await fetchAppraisalForCodesWithRetry(creds, codes);
    res.status(200).json({ ok: true, records });
  } catch (err) {
    console.error('[koenig-appraisal-api]', err);
    const message = err instanceof Error ? err.message : 'Unknown error contacting Appraisal API';
    res.status(502).json({ ok: false, error: message });
  }
}
