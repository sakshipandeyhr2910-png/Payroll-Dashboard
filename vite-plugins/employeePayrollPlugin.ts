import type { Plugin, ViteDevServer, PreviewServer } from 'vite';
import type { IncomingMessage } from 'http';
import { fetchToken, fetchEmployeeByCode, type PmsCredentials } from './rayontaraApiPlugin';
import { fetchAppraisalForKoenig, type AppraisalCredentials } from './rayontaraAppraisalApiPlugin';
import type { SessionClaims } from './dashboardAuthPlugin';

// Answers "what is MY OWN payroll data", for the logged-in employee only. The gate in
// dashboardAuthPlugin.ts already guarantees every request here carries a verified 'employee'
// session (rejecting anything else with 403 before this file ever runs) and attaches its claims to
// req.sessionClaims — this handler reads empCode/entitySlug from THAT, never from a query string or
// request body, so there is no parameter an employee could change to see someone else's row.
//
// Scope note: this returns the employee's own PMS profile (name, designation, DOJ, bank details,
// location) plus their Pay Scale/currency from the Appraisal API — the same base facts HR sees.
// It does not yet replicate the full per-entity Net Payable computation (Loan/Recovery/TDS/Leave/
// Arrear/WFH, PF proration, professional tax, etc.) that EntityPage.tsx computes for HR's bulk
// view — that logic is entity-specific and deeply embedded in that component; reusing it correctly
// for a single employee is worth doing as a follow-up rather than rushing a second, divergent copy
// of a payroll calculation.
function registerMiddleware(server: ViteDevServer | PreviewServer, pmsCreds: PmsCredentials, appraisalCreds: AppraisalCredentials) {
  server.middlewares.use('/api/employee/payroll', async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.method !== 'GET') {
      res.statusCode = 405;
      res.end(JSON.stringify({ ok: false, error: 'Method not allowed' }));
      return;
    }
    const claims = (req as IncomingMessage & { sessionClaims?: SessionClaims }).sessionClaims;
    if (!claims || claims.role !== 'employee') {
      // Belt-and-suspenders — the gate middleware should already have rejected this, but a
      // handler that touches payroll data should never trust that alone.
      res.statusCode = 401;
      res.end(JSON.stringify({ ok: false, error: 'Not authenticated' }));
      return;
    }
    try {
      const token = await fetchToken(pmsCreds);
      const [record, appraisalRecords] = await Promise.all([
        fetchEmployeeByCode(pmsCreds, token, claims.empCode),
        fetchAppraisalForKoenig(appraisalCreds, [claims.empCode]),
      ]);
      if (!record) {
        res.statusCode = 404;
        res.end(JSON.stringify({ ok: false, error: 'Your employee record could not be found. Please contact HR.' }));
        return;
      }
      const appraisal = appraisalRecords[0];
      res.statusCode = 200;
      res.end(JSON.stringify({
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
      }));
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[employee-payroll]', err);
      res.statusCode = 502;
      res.end(JSON.stringify({ ok: false, error: 'Could not load your payroll data right now. Please try again shortly.' }));
    }
  });
}

export function employeePayrollPlugin(pmsCreds: PmsCredentials, appraisalCreds: AppraisalCredentials): Plugin {
  return {
    name: 'employee-payroll',
    configureServer(server) {
      registerMiddleware(server, pmsCreds, appraisalCreds);
    },
    configurePreviewServer(server) {
      registerMiddleware(server, pmsCreds, appraisalCreds);
    },
  };
}
