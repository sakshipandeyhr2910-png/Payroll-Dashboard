import type { PayrollRow } from '../types';

export const BASE_MONTH = '2026-08';

// True once a month's own last calendar day has actually passed on the real clock — deliberately
// NOT relative to BASE_MONTH (which is this dashboard's fixed illustrative "today" for sample
// data, not a real date that advances). The month-end freeze (see EntityPage.tsx and
// utils/snapshotApi.ts) needs the genuine current date: a month must actually be over in the real
// world before its data is eligible to be locked, and the current, still-in-progress month must
// never be — regardless of what BASE_MONTH happens to be pinned to.
export function isMonthCompleted(ym: string): boolean {
  const now = new Date();
  const currentYm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  return ym < currentYm;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function monthLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

export function monthDiff(ym: string, base: string): number {
  const [y1, m1] = ym.split('-').map(Number);
  const [y2, m2] = base.split('-').map(Number);
  return (y1 - y2) * 12 + (m1 - m2);
}

export function stepMonth(ym: string, delta: number): string {
  let [y, m] = ym.split('-').map(Number);
  m += delta;
  while (m > 12) { m -= 12; y += 1; }
  while (m < 1) { m += 12; y -= 1; }
  return `${y}-${String(m).padStart(2, '0')}`;
}

export function sampleFactor(ym: string): number {
  const d = monthDiff(ym, BASE_MONTH);
  if (d === 0) return 1;
  return 1 + 0.03 * Math.sin(d * 0.8) + 0.0015 * d;
}

// Only genuinely-monetary fields scale with the illustrative sample-month factor — day-count
// fields (workingDaysPerWeek, presentDays, etc.) and text fields (doj, payScale, salaryHold...)
// aren't currency amounts, so they're deliberately excluded even where present.
const SCALED_FIELDS: (keyof PayrollRow)[] = [
  'basic', 'hra', 'allowance', 'gross', 'pf', 'esi', 'vpf', 'nps', 'tds', 'pt',
  'recovery', 'loan', 'mealpass', 'localtax', 'arrear', 'overtime', 'da', 'commission', 'wfh', 'net',
  'clubSpecialAllowance', 'tada', 'appraisalArrear',
];

export function applyMonthFactor(row: PayrollRow, factor: number): PayrollRow {
  if (factor === 1) return row;
  const copy: PayrollRow = { ...row };
  SCALED_FIELDS.forEach((k) => {
    const v = copy[k];
    if (typeof v === 'number') {
      (copy[k] as number) = Math.round(v * factor * 100) / 100;
    }
  });
  return copy;
}
