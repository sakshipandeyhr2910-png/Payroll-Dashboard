// Counts weekdays (i.e. excludes only Saturdays and Sundays) in a given "YYYY-MM" month —
// used for Total Days. Computed from the month itself, never hardcoded, so it's correct for
// whichever month the month picker/stepper currently has selected.
export function weekdaysInMonth(ym: string): number {
  const [year, month] = ym.split('-').map(Number);
  const daysInMonth = new Date(year, month, 0).getDate();
  let weekdays = 0;
  for (let day = 1; day <= daysInMonth; day++) {
    const dayOfWeek = new Date(year, month - 1, day).getDay(); // 0 = Sunday, 6 = Saturday
    if (dayOfWeek !== 0 && dayOfWeek !== 6) weekdays++;
  }
  return weekdays;
}

// Present Days relative to whichever month is currently displayed — NOT a one-time figure
// fixed to the employee's own joining month. An employee who joined years before the displayed
// period was present for the whole thing (same count as Total Days); one who joined partway
// through the displayed month is only present from their DOJ onward; one whose DOJ is still in
// the future relative to the displayed month hasn't joined yet, so 0.
export function presentDaysForMonth(dojIso: string | undefined, selectedMonth: string): number | undefined {
  if (!dojIso) return undefined;
  const doj = new Date(dojIso);
  if (Number.isNaN(doj.getTime())) return undefined;

  const [selYear, selMonth] = selectedMonth.split('-').map(Number);
  const dojYear = doj.getFullYear();
  const dojMonth = doj.getMonth() + 1; // 1-indexed, to compare against selectedMonth's own 1-indexed month
  const monthsAfterDoj = (selYear - dojYear) * 12 + (selMonth - dojMonth);

  if (monthsAfterDoj < 0) return 0; // displayed month is before the employee even joined
  if (monthsAfterDoj > 0) return weekdaysInMonth(selectedMonth); // joined before the displayed month — present throughout

  // Joined during the displayed month itself — count from the DOJ's day through month end.
  const startDay = doj.getDate();
  const daysInMonth = new Date(selYear, selMonth, 0).getDate();
  let count = 0;
  for (let day = startDay; day <= daysInMonth; day++) {
    const dayOfWeek = new Date(selYear, selMonth - 1, day).getDay();
    if (dayOfWeek !== 0 && dayOfWeek !== 6) count++;
  }
  return count;
}

// Whether the employee had already joined by the displayed month — i.e. the DOJ isn't strictly
// after it. Used to drop a not-yet-joined employee's row entirely from a past month's register
// (see rowsForMonth in EntityPage.tsx), rather than just zeroing their attendance/pay and still
// showing the row. Deliberately NOT derived from presentDaysForMonth's return value: that also
// returns 0 for someone who genuinely joined during the displayed month but on a day with no
// weekdays left before month-end, which must NOT be filtered out — this checks the DOJ-vs-month
// relationship directly instead. No DOJ on file (sample entities) never gets filtered.
export function hasJoinedByMonth(dojIso: string | undefined, selectedMonth: string): boolean {
  if (!dojIso) return true;
  const doj = new Date(dojIso);
  if (Number.isNaN(doj.getTime())) return true;

  const [selYear, selMonth] = selectedMonth.split('-').map(Number);
  const dojYear = doj.getFullYear();
  const dojMonth = doj.getMonth() + 1;
  const monthsAfterDoj = (selYear - dojYear) * 12 + (selMonth - dojMonth);
  return monthsAfterDoj >= 0;
}
