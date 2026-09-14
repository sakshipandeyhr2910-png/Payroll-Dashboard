import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuth } from '../_lib/auth';
import { RAYONTARA_EMP_CODES } from '../_lib/rayontaraEmpCodes';
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

// Ported from vite-plugins/rayontaraLeaveApiPlugin.ts's '/api/rayontara/leave' handler.
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
    const records = await fetchLeaveForCodesWithRetry(credsFromEnv(), RAYONTARA_EMP_CODES, selectedMonth);
    res.status(200).json({ ok: true, records });
  } catch (err) {
    console.error('[rayontara-leave-api]', err);
    const message = err instanceof Error ? err.message : 'Unknown error contacting Employee Leave Details API';
    res.status(502).json({ ok: false, error: message });
  }
}
