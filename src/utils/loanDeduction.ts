import { monthDiff } from './month';

export interface LoanAdvanceRecord {
  code: number;
  advanceAmount: number;
  dateGiven: string; // raw date string from the API
}

// Start-month rule: an advance given before the 16th starts repayment that same month; on or
// after the 16th, repayment starts the following month (e.g. 16th August advance -> first
// deduction in September, not August).
export function advanceStartMonth(dateGiven: string): string | null {
  const d = new Date(dateGiven);
  if (Number.isNaN(d.getTime())) return null;
  const year = d.getFullYear();
  const month = d.getMonth() + 1; // 1-indexed
  const day = d.getDate();
  if (day < 16) return `${year}-${String(month).padStart(2, '0')}`;
  let nextYear = year;
  let nextMonth = month + 1;
  if (nextMonth > 12) { nextMonth = 1; nextYear += 1; }
  return `${nextYear}-${String(nextMonth).padStart(2, '0')}`;
}

// Every advance repays in exactly 4 equal monthly installments starting from its start month —
// 0 before the start month or once all 4 installments have already fallen due.
export function monthlyDeductionForAdvance(record: LoanAdvanceRecord, selectedMonth: string): number {
  const startMonth = advanceStartMonth(record.dateGiven);
  if (!startMonth) return 0;
  const installmentIndex = monthDiff(selectedMonth, startMonth); // 0 = first installment month
  if (installmentIndex < 0 || installmentIndex >= 4) return 0;
  return Math.round((record.advanceAmount / 4) * 100) / 100;
}

// An employee can have more than one advance on file at once — total deduction for the
// displayed month is the sum of whichever installments are currently due across all of them.
export function totalLoanDeductionForMonth(records: LoanAdvanceRecord[], selectedMonth: string): number {
  return Math.round(
    records.reduce((sum, r) => sum + monthlyDeductionForAdvance(r, selectedMonth), 0) * 100,
  ) / 100;
}
