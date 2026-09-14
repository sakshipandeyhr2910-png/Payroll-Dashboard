import type { ArrearRecord } from './rayontaraArrearApi';

function monthKeyOf(dateStr: string | null): string | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthDiff(aKey: string, bKey: string): number {
  const [ay, am] = aKey.split('-').map(Number);
  const [by, bm] = bKey.split('-').map(Number);
  return (ay - by) * 12 + (am - bm);
}

// Appraisal Arrear = (New Salary − Old Salary) × pending months between the appraisal's effective
// date and when it was actually entered — e.g. effective 1st July, entered 1st August → 1 pending
// month (July), and the arrear shows in August's salary (the month it's processed/paid), never
// again afterwards. Because this is a pure function of the record's own two fixed dates plus
// whichever month is being displayed, "one-time-only" falls out for free — it only equals
// selectedMonth once (createdMonth), so it can never repeat or carry forward without any extra
// state to track "already paid".
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

// The Appraisal Master API only ever returns an employee's CURRENT pay scale — it has no concept
// of "as of a given month". So once an appraisal is entered, every month's Salary (including
// months before the appraisal even existed) would otherwise show the new, post-appraisal amount.
// That double-counts the raise: the pre-appraisal month is silently overstated at the new rate,
// AND the arrear top-up above still gets added in the month it's entered. This falls back to the
// arrear record's own oldSalary for any month strictly before the appraisal was entered, and only
// the appraisal record covering the SPECIFIC employee's own dates — so it never affects an
// employee without one, or a month at/after the entry.
export function payScaleForMonth(record: ArrearRecord | undefined, selectedMonth: string, currentAmount: number): number {
  if (!record || record.oldSalary === null) return currentAmount;
  const createdMonth = monthKeyOf(record.createdDate);
  if (!createdMonth) return currentAmount;
  return monthDiff(selectedMonth, createdMonth) < 0 ? record.oldSalary : currentAmount;
}
