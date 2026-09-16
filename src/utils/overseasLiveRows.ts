import type { PayrollRow, Category } from '../types';
import type { OverseasEmployeeRaw } from './overseasLiveApi';
import type { AppraisalRecord } from './rayontaraAppraisalApi';

function fullName(e: OverseasEmployeeRaw): string {
  return [e.first_name, e.middle_name, e.last_name].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

// Same rule as koenigLiveRows.ts/rayontaraLiveRows.ts (FR-14 / BR-10).
const BLUE_COLLAR_DESIGNATION = /driver|office\s*boy|housekeeping|peon|guard|helper|watchman|cleaner|supporting staff|care\s*taker|cook|gardener/i;

function inferCategory(designation: string | null): Category {
  return designation && BLUE_COLLAR_DESIGNATION.test(designation) ? 'Blue' : 'White';
}

function formatDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function parseWorkingDays(s: string | number | null): number | undefined {
  if (s === null || (typeof s === 'string' && s.trim() === '')) return undefined;
  const n = Number(s);
  return Number.isNaN(n) ? undefined : n;
}

function toBool(v: string | null | undefined): boolean {
  if (typeof v !== 'string') return false;
  const s = v.trim().toLowerCase();
  return s === 'true' || s === 'yes';
}

function formatAmount(n: number | null): string {
  return (n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

// Same convention as koenigLiveRows.ts/rayontaraLiveRows.ts's formatPayScale: shown as a plain
// number, no currency suffix (the Appraisal API's own currency per record isn't necessarily the
// entity's payout currency — see the `currency` param below).
function formatPayScale(record: AppraisalRecord | undefined): string {
  if (!record || record.amount === null) return '';
  return formatAmount(record.amount);
}

// Builds Payroll Register rows for one of the 8 overseas country entities (Dubai, USA, UK, New
// Zealand, Australia, Malaysia, Saudi, Canada) from the shared Is_oversease=true PMS employee
// list, already filtered down to this entity by classifyOverseasEmployee. Pay Scale is live from
// the Appraisal API (api_key 328), same as Koenig/Rayontara/Global — Salary and ESI derive from it
// automatically via EntityPage.tsx's generic (not entity-scoped) Pay-Scale-driven computation.
// PF and NPS are deliberately left NaN here even though the same Appraisal record carries them —
// those are India-specific figures, and every overseas entity's own notes already say
// India-specific statutory deductions don't apply here (EntityPage.tsx separately re-scopes ESI's
// generic computation for the same reason — see isAppraisalPfEntity). Unlike Koenig/Global, there's
// no Loan/Meal/Recovery/TDS/Leave/WFH integration for these entities — those columns stay NaN
// (renders as "—"), same reasoning as koenigLiveRows.ts for fields the PMS API doesn't provide.
// `currency` is passed in per-entity (each country pays in its own currency) rather than
// hardcoded, unlike Koenig/Global which are always INR.
export function buildOverseasLiveRows(
  employees: OverseasEmployeeRaw[],
  currency: string,
  appraisalByCode: Map<number, AppraisalRecord> = new Map(),
): PayrollRow[] {
  return employees.map((e) => {
    const hasResigned = Boolean(e.date_of_resigantion);
    const resignedOn = formatDate(e.date_of_resigantion);
    const appraisal = e.code !== null ? appraisalByCode.get(e.code) : undefined;
    return {
      code: e.code ?? NaN,
      name: fullName(e) || '—',
      designation: e.designation_name || '—',
      category: inferCategory(e.designation_name),
      doj: formatDate(e.date_of_joining),
      dojRaw: e.date_of_joining || undefined,
      basic: NaN,
      hra: NaN,
      allowance: NaN,
      gross: NaN,
      pf: NaN,
      esi: NaN,
      vpf: NaN,
      nps: NaN,
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
      currency,
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
