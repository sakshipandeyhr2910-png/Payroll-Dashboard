import type { Plugin, ViteDevServer, PreviewServer } from 'vite';
import type { IncomingMessage } from 'http';
import { fetchToken, fetchEmployeeByCode, type PmsCredentials } from './rayontaraApiPlugin';
import { fetchAppraisalForKoenig, type AppraisalCredentials } from './rayontaraAppraisalApiPlugin';
import { fetchAdvancesWithRetry, type LoanCredentials } from './rayontaraLoanApiPlugin';
import { fetchArrearWithRetry, type ArrearCredentials, type ArrearRecord } from './rayontaraArrearApiPlugin';
import { fetchRecoveryWithRetry, type RecoveryCredentials } from './rayontaraRecoveryApiPlugin';
import { fetchTdsWithRetry, type TdsCredentials } from './rayontaraTdsApiPlugin';
import { fetchWfhWithRetry, type WfhCredentials } from './rayontaraWfhApiPlugin';
import type { SessionClaims } from './dashboardAuthPlugin';
import {
  professionalTaxForLocation,
  weekdaysInMonth,
  presentDaysForMonth,
  appraisalArrearForMonth,
  payScaleForMonth,
  totalLoanDeductionForMonth,
  round2,
  toCalcNumber,
} from './payrollCompute';

// Local-dev mirror of api/_lib/routes/employeePayroll.ts — see that file's header comment for the
// full reasoning (same per-entity scoping flags, same net payable formula, same one deliberate
// gap: Meal Passes isn't wired in yet). Answers "what is MY OWN payroll data for a given month",
// deriving empCode/entitySlug from req.sessionClaims (set by dashboardAuthPlugin.ts's gate, which
// already rejected anything that isn't a verified 'employee' session before this file ever runs).
const REAL_CODE_ENTITIES = new Set(['koenig', 'rayontara', 'global']);
const MONTH_PATTERN = /^\d{4}-\d{2}$/;
function defaultMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export interface EmployeePayrollCredentials {
  pms: PmsCredentials;
  appraisal: AppraisalCredentials;
  loan: LoanCredentials;
  arrear: ArrearCredentials;
  recovery: RecoveryCredentials;
  tds: TdsCredentials;
  wfh: WfhCredentials;
}

function registerMiddleware(server: ViteDevServer | PreviewServer, creds: EmployeePayrollCredentials) {
  server.middlewares.use('/api/employee/payroll', async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.method !== 'GET') {
      res.statusCode = 405;
      res.end(JSON.stringify({ ok: false, error: 'Method not allowed' }));
      return;
    }
    const claims = (req as IncomingMessage & { sessionClaims?: SessionClaims }).sessionClaims;
    if (!claims || claims.role !== 'employee') {
      res.statusCode = 401;
      res.end(JSON.stringify({ ok: false, error: 'Not authenticated' }));
      return;
    }

    const url = new URL(req.url || '', 'http://localhost');
    const monthParam = url.searchParams.get('month') || '';
    const month = MONTH_PATTERN.test(monthParam) ? monthParam : defaultMonth();
    const entitySlug = claims.entitySlug;
    const isRealCodeEntity = REAL_CODE_ENTITIES.has(entitySlug);
    const isAppraisalPfEntity = isRealCodeEntity;
    const isRecoveryScopedEntity = isRealCodeEntity || entitySlug === 'dubai';
    const isWfhScopedEntity = entitySlug === 'global';
    const codes = [claims.empCode];

    try {
      const token = await fetchToken(creds.pms);
      const [record, appraisalRecords, loanRecords, arrearRecords, recoveryRecords, tdsRecords, wfhRecords] = await Promise.all([
        fetchEmployeeByCode(creds.pms, token, claims.empCode),
        fetchAppraisalForKoenig(creds.appraisal, codes),
        fetchAdvancesWithRetry(creds.loan, codes),
        fetchArrearWithRetry(creds.arrear, codes),
        isRecoveryScopedEntity ? fetchRecoveryWithRetry(creds.recovery, codes, month) : Promise.resolve([]),
        isRealCodeEntity ? fetchTdsWithRetry(creds.tds, codes, month) : Promise.resolve([]),
        isWfhScopedEntity ? fetchWfhWithRetry(creds.wfh, month) : Promise.resolve([]),
      ]);

      if (!record) {
        res.statusCode = 404;
        res.end(JSON.stringify({ ok: false, error: 'Your employee record could not be found. Please contact HR.' }));
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

      res.statusCode = 200;
      res.end(JSON.stringify({
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
      }));
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[employee-payroll]', err);
      res.statusCode = 502;
      res.end(JSON.stringify({ ok: false, error: 'Could not load your payroll data right now. Please try again shortly.' }));
    }
  });
}

export function employeePayrollPlugin(creds: EmployeePayrollCredentials): Plugin {
  return {
    name: 'employee-payroll',
    configureServer(server) {
      registerMiddleware(server, creds);
    },
    configurePreviewServer(server) {
      registerMiddleware(server, creds);
    },
  };
}
