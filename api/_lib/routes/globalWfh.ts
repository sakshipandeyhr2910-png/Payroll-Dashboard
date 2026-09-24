import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuth } from '../auth.js';
import { fetchWfhReimbursementsWithRetry, type WfhCredentials } from '../wfhClient.js';

function credsFromEnv(): WfhCredentials {
  return {
    base: process.env.WFH_API_BASE || '',
    username: process.env.WFH_USERNAME || '',
    password: process.env.WFH_PASSWORD || '',
    role: process.env.WFH_ROLE || '',
    apiKey: process.env.WFH_API_KEY || '',
  };
}

// Ported from vite-plugins/rayontaraWfhApiPlugin.ts's '/api/global/wfh' handler.
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
    const records = await fetchWfhReimbursementsWithRetry(credsFromEnv(), selectedMonth);
    res.status(200).json({ ok: true, records });
  } catch (err) {
    console.error('[global-wfh-api]', err);
    const message = err instanceof Error ? err.message : 'Unknown error contacting WFH Infra Reimbursement API';
    res.status(502).json({ ok: false, error: message });
  }
}
