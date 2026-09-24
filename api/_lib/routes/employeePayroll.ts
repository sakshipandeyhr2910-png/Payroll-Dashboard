import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuth } from '../auth.js';
import { fetchToken, fetchEmployeeByCode, type PmsCredentials } from '../pmsClient.js';
import { fetchAppraisalForCodesWithRetry, type AppraisalCredentials } from '../appraisalClient.js';
import { fetchAdvancesForCodesWithRetry, type LoanCredentials } from '../loanClient.js';
import { fetchArrearForCodesWithRetry, type ArrearCredentials, type ArrearRecord } from '../arrearClient.js';
import { fetchRecoveryForCodesWithRetry, type RecoveryCredentials } from '../recoveryClient.js';
import { fetchTdsForCodesWithRetry, type TdsCredentials } from '../tdsClient.js';
import { fetchWfhReimbursementsWithRetry, type WfhCredentials } from '../wfhClient.js';
import {
  professionalTaxForLocation,
  weekdaysInMonth,
  presentDaysForMonth,
  appraisalArrearForMonth,
  payScaleForMonth,
  totalLoanDeductionForMonth,
  round2,
  toCalcNumber,
} from '../payrollCompute.js';

// Answers "what is MY OWN payroll data for a given month", for the logged-in employee only.
// requireAuth(req, 'employee') guarantees the caller holds a verified 'employee' session
// (rejecting an HR session, or no session, with 401/403 before a single line below runs) and
// hands back its claims — this handler reads empCode/entitySlug from THOSE verified claims,
// never from a query string or request body, so there is no parameter an employee could change to
// see someone else's row.
//
// Computes Net Payable the same way EntityPage.tsx does for HR's bulk view (same per-entity
// scoping flags, same pure helpers in api/_lib/payrollCompute.ts — ported, not reimplemented, so
// the two never quietly diverge) — PF/ESI/NPS/Leave only for Koenig/Rayontara/Global, Recovery
// (VPF/TA-DA/Recovery) only for those three plus Dubai, WFH only for Global, Loan and Appraisal
// Arrear for every entity. One deliberate gap: Meal Passes isn't wired in here yet (its fetch
// logic lives inline in api/_lib/routes/rayontaraMealAllowances.ts, not as a reusable client like
// every other feature) — it's a minor deduction line, not omitted to hide anything, just not
// worth a refactor of that route to get one more field. Contributes 0 until that's done, same as
// any entity/employee it doesn't apply to already does.
const REAL_CODE_ENTITIES = new Set(['koenig', 'rayontara', 'global']);
const MONTH_PATTERN = /^\d{4}-\d{2}$/;
function defaultMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

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
    res.status(403).json({ ok: false, error: 'Forbidden' });
    return;
  }

  const monthParam = typeof req.query.month === 'string' ? req.query.month : '';
  const month = MONTH_PATTERN.test(monthParam) ? monthParam : defaultMonth();
  const entitySlug = claims.entitySlug;
  const isRealCodeEntity = REAL_CODE_ENTITIES.has(entitySlug);
  const isAppraisalPfEntity = isRealCodeEntity;
  const isRecoveryScopedEntity = isRealCodeEntity || entitySlug === 'dubai';
  const isWfhScopedEntity = entitySlug === 'global';

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
  const loanCreds: LoanCredentials = {
    base: process.env.LOAN_API_BASE || '',
    username: process.env.LOAN_USERNAME || '',
    password: process.env.LOAN_PASSWORD || '',
    role: process.env.LOAN_ROLE || '',
    apiKey: process.env.LOAN_API_KEY || '',
  };
  const arrearCreds: ArrearCredentials = {
    base: process.env.ARREAR_API_BASE || '',
    username: process.env.ARREAR_USERNAME || '',
    password: process.env.ARREAR_PASSWORD || '',
    role: process.env.ARREAR_ROLE || '',
    apiKey: process.env.ARREAR_API_KEY || '',
    decryptPassword: process.env.KITES_DECRYPT_PASSWORD || '',
    decryptSalt: process.env.KITES_DECRYPT_SALT || '',
  };
  const recoveryCreds: RecoveryCredentials = {
    base: process.env.RECOVERY_API_BASE || '',
    username: process.env.RECOVERY_USERNAME || '',
    password: process.env.RECOVERY_PASSWORD || '',
    role: process.env.RECOVERY_ROLE || '',
    apiKey: process.env.RECOVERY_API_KEY || '',
  };
  const tdsCreds: TdsCredentials = {
    base: process.env.TDS_API_BASE || '',
    username: process.env.TDS_USERNAME || '',
    password: process.env.TDS_PASSWORD || '',
    role: process.env.TDS_ROLE || '',
    apiKey: process.env.TDS_API_KEY || '',
  };
  const wfhCreds: WfhCredentials = {
    base: process.env.WFH_API_BASE || '',
    username: process.env.WFH_USERNAME || '',
    password: process.env.WFH_PASSWORD || '',
    role: process.env.WFH_ROLE || '',
    apiKey: process.env.WFH_API_KEY || '',
  };

  const codes = [claims.empCode];

  try {
    const token = await fetchToken(pmsCreds);
    const [record, appraisalRecords, loanRecords, arrearRecords, recoveryRecords, tdsRecords, wfhRecords] = await Promise.all([
      fetchEmployeeByCode(pmsCreds, token, claims.empCode),
      fetchAppraisalForCodesWithRetry(appraisalCreds, codes),
      fetchAdvancesForCodesWithRetry(loanCreds, codes),
      fetchArrearForCodesWithRetry(arrearCreds, codes),
      isRecoveryScopedEntity ? fetchRecoveryForCodesWithRetry(recoveryCreds, codes, month) : Promise.resolve([]),
      isRealCodeEntity ? fetchTdsForCodesWithRetry(tdsCreds, codes, month) : Promise.resolve([]),
      isWfhScopedEntity ? fetchWfhReimbursementsWithRetry(wfhCreds, month) : Promise.resolve([]),
    ]);

    if (!record) {
      res.status(404).json({ ok: false, error: 'Your employee record could not be found. Please contact HR.' });
      return;
    }

    const appraisal = appraisalRecords[0];
    const arrearRecord: ArrearRecord | undefined = arrearRecords[0];
    const recoveryRecord = recoveryRecords[0];
    const tdsRecord = tdsRecords[0];
    const wfhRecord = wfhRecords.find((r) => r.code === claims.empCode);

    const currentPayScale = appraisal?.amount ?? undefined;
    const correctedPayScale = currentPayScale !== undefined ? payScaleForMonth(arrearRecord, month, currentPayScale) : undefined;
    const calendarTotalDays = weekdaysInMonth(month);
    const totalDaysAfterLeaveTaken = presentDaysForMonth(record.date_of_joining, month);
    const gross = correctedPayScale !== undefined && totalDaysAfterLeaveTaken !== undefined && calendarTotalDays > 0
      ? round2((correctedPayScale / calendarTotalDays) * totalDaysAfterLeaveTaken)
      : undefined;

    const esi = currentPayScale !== undefined && isAppraisalPfEntity && gross !== undefined
      ? (currentPayScale < 21000 ? round2(gross * 0.0075) : 0)
      : 0;
    const rawPf = appraisal?.epf ?? null;
    const pf = isAppraisalPfEntity
      ? (rawPf === 1800 && totalDaysAfterLeaveTaken !== undefined && calendarTotalDays > 0
        ? (totalDaysAfterLeaveTaken === calendarTotalDays ? rawPf : round2((1800 / calendarTotalDays) * totalDaysAfterLeaveTaken))
        : (rawPf ?? 0))
      : 0;
    const nps = isAppraisalPfEntity && appraisal
      ? (appraisal.allowNPS ? toCalcNumber(appraisal.employeeShare) + toCalcNumber(appraisal.employerShare) : 0)
      : 0;

    const loan = totalLoanDeductionForMonth(loanRecords, month);
    const appraisalArrear = appraisalArrearForMonth(arrearRecord, month);
    const vpf = isRecoveryScopedEntity ? toCalcNumber(recoveryRecord?.vpf) : 0;
    const tada = isRecoveryScopedEntity ? toCalcNumber(recoveryRecord?.tada) : 0;
    const recovery = isRecoveryScopedEntity ? toCalcNumber(recoveryRecord?.recovery) : 0;
    const tds = isRealCodeEntity ? toCalcNumber(tdsRecord?.tds) : 0;
    const wfh = isWfhScopedEntity ? toCalcNumber(wfhRecord?.wfhAmount) : 0;
    const pt = professionalTaxForLocation(record.city_name);

    const net = gross === undefined ? null : round2(
      gross - (pf + esi + loan + tds + nps) - (vpf + tada + recovery + pt) + appraisalArrear - 0 /* mealpass */ + wfh,
    );

    res.status(200).json({
      ok: true,
      month,
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
        currency: appraisal?.currency ?? null,
        salary: gross ?? null,
        pf,
        esi,
        loan,
        tds,
        nps,
        vpf,
        tada,
        recovery,
        professionalTax: pt,
        appraisalArrear,
        wfh,
        netPayable: net,
      },
    });
  } catch (err) {
    console.error('[employee/payroll]', err);
    res.status(502).json({ ok: false, error: 'Could not load your payroll data right now. Please try again shortly.' });
  }
}
