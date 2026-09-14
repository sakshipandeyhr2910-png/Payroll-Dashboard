import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuth } from '../_lib/auth';
import { RAYONTARA_EMP_CODES } from '../_lib/rayontaraEmpCodes';
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

// Ported from vite-plugins/rayontaraLoanApiPlugin.ts's '/api/rayontara/loans' handler.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await requireAuth(req);
  if (!auth.ok) {
    res.status(auth.status).json(auth.body);
    return;
  }

  try {
    const records = await fetchAdvancesForCodesWithRetry(credsFromEnv(), RAYONTARA_EMP_CODES);
    res.status(200).json({ ok: true, records });
  } catch (err) {
    console.error('[rayontara-loan-api]', err);
    const message = err instanceof Error ? err.message : 'Unknown error contacting Loan Advance API';
    res.status(502).json({ ok: false, error: message });
  }
}
