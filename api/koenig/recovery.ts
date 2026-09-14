import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuth } from '../_lib/auth';
import { readJsonBody } from '../_lib/readBody';
import { fetchRecoveryForCodesWithRetry, type RecoveryCredentials } from '../_lib/recoveryClient';

function credsFromEnv(): RecoveryCredentials {
  return {
    base: process.env.RECOVERY_API_BASE || '',
    username: process.env.RECOVERY_USERNAME || '',
    password: process.env.RECOVERY_PASSWORD || '',
    role: process.env.RECOVERY_ROLE || '',
    apiKey: process.env.RECOVERY_API_KEY || '',
  };
}

// Ported from vite-plugins/rayontaraRecoveryApiPlugin.ts's '/api/koenig/recovery' handler.
// Koenig's (and Global's) codes are only known client-side, so they're sent up in the request
// body along with the month.
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
    const records = await fetchRecoveryForCodesWithRetry(credsFromEnv(), codes, selectedMonth);
    res.status(200).json({ ok: true, records });
  } catch (err) {
    console.error('[koenig-recovery-api]', err);
    const message = err instanceof Error ? err.message : 'Unknown error contacting Employee Recovery Details API';
    res.status(502).json({ ok: false, error: message });
  }
}
