import type { PayrollRow, Category } from '../types';
import type { KoenigEmployeeRaw } from './koenigLiveApi';
import type { AppraisalRecord } from './rayontaraAppraisalApi';

function fullName(e: KoenigEmployeeRaw): string {
  return [e.first_name, e.middle_name, e.last_name].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

// Same rule as rayontaraLiveRows.ts (FR-14 / BR-10), plus "care taker", "cook" and "gardener"
// seen in this entity's own data — confirmed against the full 62-designation list across all 579
// company employees, every other designation is a professional/managerial/technical role.
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

function formatAmount(n: number | null): string {
  return (n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

// Same convention as rayontaraLiveRows.ts's formatPayScale: Amount goes in the Pay Scale column
// (the Appraisal API's own naming) — per explicit request, shown as a plain number with no
// currency suffix. Takes the already-corrected amount (see CURRENCY_CORRECTIONS above), not the
// raw record, so a corrected employee's Pay Scale reflects the converted figure.
function formatPayScale(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) return '';
  return formatAmount(amount);
}

// Same convention as rayontaraLiveRows.ts's parseWorkingDays — the PMS API's own working_days
// field (confirmed live: 5/5.5/6/7, not just 5 or 6) is more precise than inferring Working Days
// Per Week from designation, so it's carried through here per explicit request instead.
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

// Per-employee currency corrections, added on explicit confirmation per employee — NOT a general
// policy change (every non-UAE Global employee, e.g. Lagos/Cairo/Accra, genuinely IS paid in USD,
// so reclassifying by city/country would risk silently mislabeling people who are correctly paid
// in their own local currency). Each entry converts the amount itself (not just the label) at the
// mid-market rate from https://www.xe.com/currencyconverter/ on the date noted:
//   - 3742 (Neda Mohammed): confirmed Dubai-based like codes 4829/4883, who already correctly show
//     AED — her Appraisal record alone said USD. Rate 3.6725 is the UAE's fixed currency-board
//     peg to USD, so it won't drift and never needs revisiting.
//   - 3287 (Imran Sheikh): confirmed to process in AED despite his Appraisal record saying EUR.
//     Rate 4.20893 (as of 2026-09-17) is a FLOATING market rate, unlike the USD peg above — it
//     WILL drift over time and should be refreshed from the same converter periodically, unlike
//     the 3742 entry.
const CURRENCY_CORRECTIONS: Record<number, { fromCurrency: string; toCurrency: string; rate: number }> = {
  3742: { fromCurrency: 'USD', toCurrency: 'AED', rate: 3.6725 },
  3287: { fromCurrency: 'EUR', toCurrency: 'AED', rate: 4.20893 },
};

function correctedAppraisalAmount(code: number | null, amount: number | null, currency: string | null): number | null {
  if (code === null || amount === null) return amount;
  const correction = CURRENCY_CORRECTIONS[code];
  if (!correction || currency !== correction.fromCurrency) return amount;
  return Math.round(amount * correction.rate * 100) / 100;
}

function correctedCurrency(code: number | null, currency: string | null): string | null {
  if (code === null) return currency;
  const correction = CURRENCY_CORRECTIONS[code];
  if (!correction || currency !== correction.fromCurrency) return currency;
  return correction.toCurrency;
}

// Emp Code is recovered server-side (see koenigLiveApi.ts / vite-plugins/rayontaraApiPlugin.ts)
// by scanning the per-code PMS endpoint and matching back by exact name — it's null, not
// fabricated, when no unambiguous match exists. Only rows that got a code can be looked up in the
// Appraisal API (Pay Scale, PF, NPS) — those without one keep every financial column as NaN
// (renders as "—"). Loan/Meal/Recovery still aren't linked for Koenig at all yet.
//
// Currency: the Appraisal API returns its own `currency` per employee alongside Pay Scale, and
// it's frequently NOT the entity's nominal payout currency — confirmed live, Global-DMCC's 35
// employees are actually 32 USD / 2 AED / 1 EUR (never AED-only), and even Koenig (nominally
// India-only) has 2 USD entries among its 491. A row uses its own matched Appraisal record's
// currency; `defaultCurrency` only covers rows with no Appraisal match (no code recovered, or the
// API simply didn't return one) or a null currency on the record itself.
export function buildKoenigLiveRows(
  employees: KoenigEmployeeRaw[],
  appraisalByCode: Map<number, AppraisalRecord> = new Map(),
  defaultCurrency = 'INR',
): PayrollRow[] {
  return employees.map((e) => {
    const hasResigned = Boolean(e.date_of_resigantion);
    const resignedOn = formatDate(e.date_of_resigantion);
    const appraisal = e.code !== null ? appraisalByCode.get(e.code) : undefined;
    const correctedAmount = appraisal ? correctedAppraisalAmount(e.code, appraisal.amount, appraisal.currency) : null;
    const rowCurrency = appraisal ? correctedCurrency(e.code, appraisal.currency) : null;
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
      pf: appraisal?.epf ?? NaN,
      esi: NaN,
      vpf: NaN,
      // Not being NPS-enrolled is a real, known fact the API states explicitly, not an unknown —
      // same reasoning as rayontaraLiveRows.ts. A single combined total (Employee + Employer
      // share) per explicit request, rather than the two shares shown separately.
      nps: appraisal?.allowNPS
        ? (appraisal.employeeShare ?? 0) + (appraisal.employerShare ?? 0)
        : (appraisal ? 0 : NaN),
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
      currency: rowCurrency ?? defaultCurrency,
      remarks: hasResigned ? `Date of Resignation: ${resignedOn}` : '',
      salaryHold: hasResigned ? 'Yes' : 'No',
      uan: e.UAN || '',
      bankname: e.bank_name || '',
      bankacc: e.bank_account || '',
      ifsc: e.ifsc_code || '',
      location: e.city_name || '',
      payScale: formatPayScale(correctedAmount),
      payScaleAmount: correctedAmount ?? undefined,
      workingDaysPerWeek: parseWorkingDays(e.working_days),
      isBlueCollarJob: toBool(e.Is_blue_collared_job),
    };
  });
}
