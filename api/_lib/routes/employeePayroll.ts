import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuth } from '../auth';
import { fetchToken, fetchEmployeeByCode, type PmsCredentials } from '../pmsClient';
import { fetchAppraisalForCodesWithRetry, type AppraisalCredentials } from '../appraisalClient';

// Answers "what is MY OWN payroll data", for the logged-in employee only. requireAuth(req,
// 'employee') guarantees the caller holds a verified 'employee' session (rejecting an HR session,
// or no session, with 401/403 before a single line below runs) and hands back its claims — this
// handler reads empCode/entitySlug from THOSE verified claims, never from a query string or
// request body, so there is no parameter an employee could change to see someone else's row.
//
// Scope note: returns the employee's own PMS profile (name, designation, DOJ, bank details,
// location) plus their Pay Scale/currency from the Appraisal API — the same base facts HR sees.
// It does not yet replicate the full per-entity Net Payable computation (Loan/Recovery/TDS/Leave/
// Arrear/WFH, PF proration, professional tax, etc.) that EntityPage.tsx computes for HR's bulk
// view — that logic is entity-specific and deeply embedded in that component; reusing it correctly
// for a single employee is worth doing as a follow-up rather than rushing a second, divergent copy
// of a payroll calculation.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.status(405).json({ ok: false, error: 'Method not allowed' });
    return;
  }
  const auth = await requireAuth(req, 'employee');
  if (!auth.ok) {
    res.status(auth.status).json(auth.body);
    return;
  }
  const claims = auth.claims;
  if (claims.role !== 'employee') {
    // Unreachable given requireAuth(req, 'employee') above, but a handler touching payroll data
    // should never trust a type narrowing alone.
    res.status(403).json({ ok: false, error: 'Forbidden' });
    return;
  }

  const pmsCreds: PmsCredentials = {
    base: process.env.PMS_API_BASE || '',
    username: process.env.PMS_USERNAME || '',
    password: process.env.PMS_PASSWORD || '',
    role: process.env.PMS_ROLE || '',
    apiKey: process.env.PMS_API_KEY || '',
  };
  const appraisalCreds: AppraisalCredentials = {
    base: process.env.APPRAISAL_API_BASE || '',
    username: process.env.APPRAISAL_USERNAME || '',
    password: process.env.APPRAISAL_PASSWORD || '',
    role: process.env.APPRAISAL_ROLE || '',
    apiKey: process.env.APPRAISAL_API_KEY || '',
    decryptPassword: process.env.KITES_DECRYPT_PASSWORD || '',
    decryptSalt: process.env.KITES_DECRYPT_SALT || '',
  };

  try {
    const token = await fetchToken(pmsCreds);
    const [record, appraisalRecords] = await Promise.all([
      fetchEmployeeByCode(pmsCreds, token, claims.empCode),
      fetchAppraisalForCodesWithRetry(appraisalCreds, [claims.empCode]),
    ]);
    if (!record) {
      res.status(404).json({ ok: false, error: 'Your employee record could not be found. Please contact HR.' });
      return;
    }
    const appraisal = appraisalRecords[0];
    res.status(200).json({
      ok: true,
      employee: {
        code: claims.empCode,
        entitySlug: claims.entitySlug,
        name: claims.name,
        email: claims.email,
        designation: record.designation_name,
        department: record.deparment_name,
        dateOfJoining: record.date_of_joining,
        location: record.city_name,
        country: record.country_name,
        bankName: record.bank_name,
        bankAccount: record.bank_account,
        ifsc: record.ifsc_code,
        uan: record.UAN,
        manager: record.manager_name,
        resigned: !!record.date_of_resigantion,
        resignationDate: record.date_of_resigantion,
        payScale: appraisal?.amount ?? null,
        currency: appraisal?.currency ?? null,
      },
    });
  } catch (err) {
    console.error('[employee/payroll]', err);
    res.status(502).json({ ok: false, error: 'Could not load your payroll data right now. Please try again shortly.' });
  }
}
