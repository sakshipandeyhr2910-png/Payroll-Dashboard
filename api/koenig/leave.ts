import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuth } from '../_lib/auth';
import { readJsonBody } from '../_lib/readBody';
import { fetchLeaveForCodesWithRetry, type LeaveCredentials } from '../_lib/leaveClient';

function credsFromEnv(): LeaveCredentials {
  return {
    base: process.env.LEAVE_API_BASE || '',
    username: process.env.LEAVE_USERNAME || '',
    password: process.env.LEAVE_PASSWORD || '',
    role: process.env.LEAVE_ROLE || '',
    apiKey: process.env.LEAVE_API_KEY || '',
  };
}

// Ported from vite-plugins/rayontaraLeaveApiPlugin.ts's '/api/koenig/leave' handler. Koenig's
// codes are only known client-side, so they're sent up in the request body along with the month.
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
    const records = await fetchLeaveForCodesWithRetry(credsFromEnv(), codes, selectedMonth);
    res.status(200).json({ ok: true, records });
  } catch (err) {
    console.error('[koenig-leave-api]', err);
    const message = err instanceof Error ? err.message : 'Unknown error contacting Employee Leave Details API';
    res.status(502).json({ ok: false, error: message });
  }
}
