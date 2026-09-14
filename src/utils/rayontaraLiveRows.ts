import type { PayrollRow, Category } from '../types';
import type { PmsEmployee } from './rayontaraLiveApi';
import type { AppraisalRecord } from './rayontaraAppraisalApi';

function fullName(e: PmsEmployee): string {
  return [e.first_name, e.middle_name, e.last_name].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

// The PMS API has no category field — infer White/Blue Collar from designation, matching this
// dashboard's existing business rule that Blue Collar covers manual/support roles (FR-14 / BR-10).
// Kept in sync with koenigLiveRows.ts's list ("care taker", "cook", "gardener" included) since
// both entities draw from the same company-wide PMS employee universe.
const BLUE_COLLAR_DESIGNATION = /driver|office\s*boy|housekeeping|peon|guard|helper|watchman|cleaner|supporting staff|care\s*taker|cook|gardener/i;

function inferCategory(designation: string | null): Category {
  return designation && BLUE_COLLAR_DESIGNATION.test(designation) ? 'Blue' : 'White';
}

// The API returns date_of_joining as an ISO datetime string (e.g. "2017-12-01T00:00:00") —
// the time component is always midnight/irrelevant, so format down to a readable date only.
function formatDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatAmount(n: number | null): string {
  return (n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

// Amount goes in the Pay Scale column per explicit instruction (the Appraisal API's own naming,
// not a mismatch on our end) — per explicit request, shown as a plain number with no currency
// suffix.
function formatPayScale(record: AppraisalRecord | undefined): string {
  if (!record || record.amount === null) return '';
  return formatAmount(record.amount);
}

// The PMS API's own working_days field (confirmed live: values are 5/5.5/6/7, not just 5 or 6 —
// e.g. "Care taker" roles show 7) is more precise than inferring Working Days Per Week from
// designation, so it's carried through here per explicit request instead.
function parseWorkingDays(s: string | number | null): number | undefined {
  if (s === null || (typeof s === 'string' && s.trim() === '')) return undefined;
  const n = Number(s);
  return Number.isNaN(n) ? undefined : n;
}

// Same encoding uncertainty as Is_global (rayontaraApiPlugin.ts) — accepts "true" or "yes"
// case-insensitively since Koenig's own API isn't consistent about which one it uses per field.
function toBool(v: string | null | undefined): boolean {
  if (typeof v !== 'string') return false;
  const s = v.trim().toLowerCase();
  return s === 'true' || s === 'yes';
}

// This PMS endpoint returns HR employee-master fields only — no salary figures. Those columns
// render as NaN here, which utils/format.ts's fmt() renders as "—" rather than a misleading 0,
// since this dashboard doesn't fabricate financial data. Emp Code isn't in the response schema
// either, but the server attaches the real code the record was queried with (see
// vite-plugins/rayontaraApiPlugin.ts) — it's authoritative, not a placeholder. Pay Scale, NPS and
// PF (from the Appraisal API's own "EPF" field) are overlaid from a second live source
// (rayontaraAppraisalApiPlugin.ts) when available.
export function buildRayontaraLiveRows(
  employees: PmsEmployee[],
  appraisalByCode: Map<number, AppraisalRecord> = new Map(),
): PayrollRow[] {
  return employees.map((e) => {
    // date_of_resigantion (the API's own spelling) is the signal for Salary Hold: an employee
    // with a resignation date on file has their salary held pending clearance, so its mere
    // presence in the API — not any separate flag — is what drives Yes/No here.
    const hasResigned = Boolean(e.date_of_resigantion);
    const resignedOn = formatDate(e.date_of_resigantion);
    const appraisal = appraisalByCode.get(e.code);

    return {
      code: e.code,
      name: fullName(e) || '—',
      designation: e.designation_name || '—',
      category: inferCategory(e.designation_name),
      doj: formatDate(e.date_of_joining),
      dojRaw: e.date_of_joining || undefined,
      basic: NaN,
      hra: NaN,
      allowance: NaN,
      gross: NaN,
      pf: appraisal?.epf ?? NaN,
      esi: NaN,
      vpf: NaN,
      // Not being NPS-enrolled is a real, known fact (the API says so explicitly), not an
      // unknown — so it shows 0 rather than "—", same reasoning as Loan Amount. A single combined
      // total (Employee + Employer share) per explicit request, rather than the two shares shown
      // separately.
      nps: appraisal?.allowNPS
        ? (appraisal.employeeShare ?? 0) + (appraisal.employerShare ?? 0)
        : 0,
      tds: NaN,
      pt: NaN,
      recovery: NaN,
      loan: NaN,
      mealpass: NaN,
      arrear: NaN,
      overtime: NaN,
      da: NaN,
      commission: NaN,
      wfh: NaN,
      localtax: NaN,
      net: NaN,
      currency: 'INR',
      remarks: hasResigned ? `Date of Resignation: ${resignedOn}` : '',
      salaryHold: hasResigned ? 'Yes' : 'No',
      uan: e.UAN || '',
      bankname: e.bank_name || '',
      bankacc: e.bank_account || '',
      ifsc: e.ifsc_code || '',
      location: e.city_name || '',
      payScale: formatPayScale(appraisal),
      payScaleAmount: appraisal?.amount ?? undefined,
      workingDaysPerWeek: parseWorkingDays(e.working_days),
      isBlueCollarJob: toBool(e.Is_blue_collared_job),
    };
  });
}
