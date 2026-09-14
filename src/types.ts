export type DataSource = 'live' | 'sample';

export interface Entity {
  slug: string;
  name: string;
  full: string;
  currency: string;
  headcount: number;
  white: number;
  blue: number;
  active: number;
  resigned: number;
  terminated: number;
  source: DataSource;
  notes: string;
}

export type Category = 'White' | 'Blue';

export interface PayrollRow {
  code: number;
  name: string;
  designation: string;
  category: Category;
  basic: number;
  hra: number;
  allowance: number;
  gross: number;
  pf: number;
  esi: number;
  vpf: number;
  // Usually a plain figure. For Rayontara (live Appraisal API), an NPS-enrolled employee's
  // Employee/Employer share amounts are combined into one display string here instead — see
  // utils/rayontaraLiveRows.ts. PayrollTable.tsx renders strings as-is, numbers via fmt().
  nps: number | string;
  tds: number;
  pt: number;
  recovery: number;
  loan: number;
  mealpass: number;
  arrear: number;
  overtime: number;
  da: number;
  commission: number;
  wfh: number;
  localtax: number;
  net: number;
  currency: string;
  remarks: string;
  uan: string;
  bankname: string;
  bankacc: string;
  ifsc: string;
  location: string;

  // Added to match the company's standard Salary Sheet column layout (Book1.xlsx). None of the
  // existing 65 employee rows have real data for these yet, so they're optional — left undefined,
  // they render as "—" (see utils/format.ts) rather than a fabricated 0.
  doj?: string;
  // Raw ISO date behind `doj` (which is pretty-printed for display) — kept separately so
  // Present Days can be recalculated per selected month without re-parsing a formatted string.
  dojRaw?: string;
  clubSpecialAllowance?: number;
  workingDaysPerWeek?: number;
  presentDays?: number;
  // Total Days minus Total Days After Leave Taken — how many of the month's working days this
  // employee was on leave/not yet present, relative to the currently displayed month (replaces
  // the old Half Days / Late Marks columns, which had no tracked data source and were always 0).
  leaveDays?: number;
  totalDays?: number;
  totalDaysAfterLeaveTaken?: number;
  payScale?: string;
  // Raw numeric amount behind `payScale` (which is formatted with currency for display) — kept
  // separately so Salary can be derived from it (Salary = Pay Scale / Total Days * Total Days
  // After Leave Taken) without re-parsing a formatted "145,000 INR" string.
  payScaleAmount?: number;
  tada?: number;
  appraisalArrear?: number;
  salaryHold?: string;
  // Raw Is_blue_collared_job flag from the PMS API, carried through so EntityPage.tsx can decide
  // per-entity whether to use it (Koenig/Rayontara) or the designation-inferred `category` above.
  isBlueCollarJob?: boolean;
}

export type CategoryFilter = 'All' | Category;
