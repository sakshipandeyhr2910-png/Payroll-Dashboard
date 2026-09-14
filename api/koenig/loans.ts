import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuth } from '../_lib/auth';
import { readJsonBody } from '../_lib/readBody';
import { fetchAdvancesForCodesWithRetry, type LoanCredentials } from '../_lib/loanClient';

function credsFromEnv(): LoanCredentials {
  return {
    base: process.env.LOAN_API_BASE || '',
    username: process.env.LOAN_USERNAME || '',
    password: process.env.LOAN_PASSWORD || '',
    role: process.env.LOAN_ROLE || '',
    apiKey: process.env.LOAN_API_KEY || '',
  };
}

// Ported from vite-plugins/rayontaraLoanApiPlugin.ts's '/api/koenig/loans' handler. Koenig's
// codes are only known client-side, so they're sent up in the request body rather than being a
// static list the server already knows, same pattern as /api/koenig/appraisal.
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

  try {
    const records = await fetchAdvancesForCodesWithRetry(credsFromEnv(), codes);
    res.status(200).json({ ok: true, records });
  } catch (err) {
    console.error('[koenig-loan-api]', err);
    const message = err instanceof Error ? err.message : 'Unknown error contacting Loan Advance API';
    res.status(502).json({ ok: false, error: message });
  }
}
