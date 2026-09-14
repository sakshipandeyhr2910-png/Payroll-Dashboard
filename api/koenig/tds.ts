import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuth } from '../_lib/auth';
import { readJsonBody } from '../_lib/readBody';
import { fetchTdsForCodesWithRetry, type TdsCredentials } from '../_lib/tdsClient';

function credsFromEnv(): TdsCredentials {
  return {
    base: process.env.TDS_API_BASE || '',
    username: process.env.TDS_USERNAME || '',
    password: process.env.TDS_PASSWORD || '',
    role: process.env.TDS_ROLE || '',
    apiKey: process.env.TDS_API_KEY || '',
  };
}

// Ported from vite-plugins/rayontaraTdsApiPlugin.ts's '/api/koenig/tds' handler. Koenig's codes
// are only known client-side, so they're sent up in the request body along with the month.
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

  const parsed = readJsonBody<{ codes?: unknown; month?: unknown }>(req);
  if (parsed === null) {
    res.status(400).json({ ok: false, error: 'Invalid JSON body' });
    return;
  }
  const codes = Array.isArray(parsed.codes)
    ? parsed.codes.map(Number).filter((n: number) => Number.isFinite(n))
    : [];
  const selectedMonth = typeof parsed.month === 'string' ? parsed.month : '';
  if (!/^\d{4}-\d{2}$/.test(selectedMonth)) {
    res.status(400).json({ ok: false, error: 'Missing or invalid "month" (expected YYYY-MM)' });
    return;
  }

  try {
    const records = await fetchTdsForCodesWithRetry(credsFromEnv(), codes, selectedMonth);
    res.status(200).json({ ok: true, records });
  } catch (err) {
    console.error('[koenig-tds-api]', err);
    const message = err instanceof Error ? err.message : 'Unknown error contacting Employee TDS Details API';
    res.status(502).json({ ok: false, error: message });
  }
}
