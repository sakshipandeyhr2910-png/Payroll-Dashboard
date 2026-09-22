// Ported pure helpers from src/utils/{professionalTax,loanDeduction,arrearCalculation,
// attendance,month}.ts (api/_lib/ never imports from src/ — same convention as
// overseasEntityMapping.ts). Used by api/_lib/routes/employeePayroll.ts to compute a single
// employee's own month-scoped Net Payable the same way EntityPage.tsx computes it for HR's bulk
// view. Keep both copies in sync if the underlying business rules ever change.
import type { LoanAdvanceRecord } from './loanClient';
import type { ArrearRecord } from './arrearClient';

const PT_BY_LOCATION: Record<string, number> = {
  bangalore: 200,
  chennai: 208,
};

export function professionalTaxForLocation(location: string | null | undefined): number {
  const key = (location || '').trim().toLowerCase();
  return PT_BY_LOCATION[key] ?? 0;
}

export function weekdaysInMonth(ym: string): number {
  const [year, month] = ym.split('-').map(Number);
  const daysInMonth = new Date(year, month, 0).getDate();
  let weekdays = 0;
  for (let day = 1; day <= daysInMonth; day++) {
    const dayOfWeek = new Date(year, month - 1, day).getDay();
    if (dayOfWeek !== 0 && dayOfWeek !== 6) weekdays++;
  }
  return weekdays;
}

export function presentDaysForMonth(dojIso: string | undefined | null, selectedMonth: string): number | undefined {
  if (!dojIso) return undefined;
  const doj = new Date(dojIso);
  if (Number.isNaN(doj.getTime())) return undefined;

  const [selYear, selMonth] = selectedMonth.split('-').map(Number);
  const dojYear = doj.getFullYear();
  const dojMonth = doj.getMonth() + 1;
  const monthsAfterDoj = (selYear - dojYear) * 12 + (selMonth - dojMonth);

  if (monthsAfterDoj < 0) return 0;
  if (monthsAfterDoj > 0) return weekdaysInMonth(selectedMonth);

  const startDay = doj.getDate();
  const daysInMonth = new Date(selYear, selMonth, 0).getDate();
  let count = 0;
  for (let day = startDay; day <= daysInMonth; day++) {
    const dayOfWeek = new Date(selYear, selMonth - 1, day).getDay();
    if (dayOfWeek !== 0 && dayOfWeek !== 6) count++;
  }
  return count;
}

export function hasJoinedByMonth(dojIso: string | undefined | null, selectedMonth: string): boolean {
  if (!dojIso) return true;
  const doj = new Date(dojIso);
  if (Number.isNaN(doj.getTime())) return true;
  const [selYear, selMonth] = selectedMonth.split('-').map(Number);
  const dojYear = doj.getFullYear();
  const dojMonth = doj.getMonth() + 1;
  const monthsAfterDoj = (selYear - dojYear) * 12 + (selMonth - dojMonth);
  return monthsAfterDoj >= 0;
}

export function monthDiff(ym: string, base: string): number {
  const [y1, m1] = ym.split('-').map(Number);
  const [y2, m2] = base.split('-').map(Number);
  return (y1 - y2) * 12 + (m1 - m2);
}

export function advanceStartMonth(dateGiven: string): string | null {
  const d = new Date(dateGiven);
  if (Number.isNaN(d.getTime())) return null;
  const year = d.getFullYear();
  const month = d.getMonth() + 1;
  const day = d.getDate();
  if (day < 16) return `${year}-${String(month).padStart(2, '0')}`;
  let nextYear = year;
  let nextMonth = month + 1;
  if (nextMonth > 12) { nextMonth = 1; nextYear += 1; }
  return `${nextYear}-${String(nextMonth).padStart(2, '0')}`;
}

export function monthlyDeductionForAdvance(record: LoanAdvanceRecord, selectedMonth: string): number {
  const startMonth = advanceStartMonth(record.dateGiven);
  if (!startMonth) return 0;
  const installmentIndex = monthDiff(selectedMonth, startMonth);
  if (installmentIndex < 0 || installmentIndex >= 4) return 0;
  return Math.round((record.advanceAmount / 4) * 100) / 100;
}

export function totalLoanDeductionForMonth(records: LoanAdvanceRecord[], selectedMonth: string): number {
  return Math.round(
    records.reduce((sum, r) => sum + monthlyDeductionForAdvance(r, selectedMonth), 0) * 100,
  ) / 100;
}

function monthKeyOf(dateStr: string | null): string | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function appraisalArrearForMonth(record: ArrearRecord | undefined, selectedMonth: string): number {
  if (!record || record.newSalary === null || record.oldSalary === null) return 0;
  const appraisalMonth = monthKeyOf(record.appraisalDate);
  const createdMonth = monthKeyOf(record.createdDate);
  if (!appraisalMonth || !createdMonth) return 0;
  if (createdMonth !== selectedMonth) return 0;
  const pendingMonths = monthDiff(createdMonth, appraisalMonth);
  if (pendingMonths <= 0) return 0;
  return Math.round((record.newSalary - record.oldSalary) * pendingMonths * 100) / 100;
}

export function payScaleForMonth(record: ArrearRecord | undefined, selectedMonth: string, currentAmount: number): number {
  if (!record || record.oldSalary === null) return currentAmount;
  const createdMonth = monthKeyOf(record.createdDate);
  if (!createdMonth) return currentAmount;
  return monthDiff(selectedMonth, createdMonth) < 0 ? record.oldSalary : currentAmount;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function toCalcNumber(v: number | string | undefined | null): number {
  if (v === undefined || v === null) return 0;
  if (typeof v === 'number') return Number.isNaN(v) ? 0 : v;
  const n = Number(v.replace(/,/g, ''));
  return Number.isNaN(n) ? 0 : n;
}
