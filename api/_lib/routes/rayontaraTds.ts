import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuth } from '../auth.js';
import { RAYONTARA_EMP_CODES } from '../rayontaraEmpCodes.js';
import { fetchTdsForCodesWithRetry, type TdsCredentials } from '../tdsClient.js';

function credsFromEnv(): TdsCredentials {
  return {
    base: process.env.TDS_API_BASE || '',
    username: process.env.TDS_USERNAME || '',
    password: process.env.TDS_PASSWORD || '',
    role: process.env.TDS_ROLE || '',
    apiKey: process.env.TDS_API_KEY || '',
  };
}

// Ported from vite-plugins/rayontaraTdsApiPlugin.ts's '/api/rayontara/tds' handler.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await requireAuth(req);
  if (!auth.ok) {
    res.status(auth.status).json(auth.body);
    return;
  }

  const selectedMonth = typeof req.query.month === 'string' ? req.query.month : '';
  if (!/^\d{4}-\d{2}$/.test(selectedMonth)) {
    res.status(400).json({ ok: false, error: 'Missing or invalid ?month=YYYY-MM query parameter' });
    return;
  }

  try {
    const records = await fetchTdsForCodesWithRetry(credsFromEnv(), RAYONTARA_EMP_CODES, selectedMonth);
    res.status(200).json({ ok: true, records });
  } catch (err) {
    console.error('[rayontara-tds-api]', err);
    const message = err instanceof Error ? err.message : 'Unknown error contacting Employee TDS Details API';
    res.status(502).json({ ok: false, error: message });
  }
}
