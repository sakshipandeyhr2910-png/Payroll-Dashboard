// NaN and undefined/null are both treated as an explicit "not provided by this data source"
// sentinel (e.g. financial columns for rows built from an HR-only API, or newer columns no
// existing row has data for yet) — rendered as a dash rather than a misleading 0.
export function fmt(n: number | undefined | null): string {
  if (n === undefined || n === null) return '—';
  if (typeof n === 'number' && Number.isNaN(n)) return '—';
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

// Coerces a formula input column to a number for use inside a computed total (e.g. Net Payable):
// unlike fmt() above, an unset/unknown value here contributes 0 rather than poisoning the whole
// sum with "—", matching how a spreadsheet formula treats a blank cell. PayrollRow.nps is typed
// number | string for legacy reasons (it used to render as a combined "Employee: X · Employer: Y"
// string — see rayontaraLiveRows.ts/koenigLiveRows.ts, now always a single numeric total), so this
// still defensively parses a leading numeric value out of a string input rather than assuming
// every caller only ever passes a number.
export function toCalcNumber(v: number | string | undefined | null): number {
  if (v === undefined || v === null) return 0;
  if (typeof v === 'number') return Number.isNaN(v) ? 0 : v;
  const n = Number(v.replace(/,/g, ''));
  return Number.isNaN(n) ? 0 : n;
}
