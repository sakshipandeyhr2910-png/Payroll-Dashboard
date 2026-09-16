import type { Entity } from '../types';

export const ENTITIES: Entity[] = [
  {
    slug: 'koenig', name: 'Koenig', full: 'Koenig India', currency: 'INR',
    headcount: 1450, white: 1300, blue: 150, active: 1310, resigned: 100, terminated: 40, source: 'sample',
    notes: '<b>Koenig (India)</b> is the primary operating entity. Professional Tax applies per registered work location: ₹200/month (₹300 in February) for Bangalore, ₹209/month for Chennai (BR-07–BR-09). Full statutory deductions apply — EPF (₹1,800 fixed where Basic ≥ ₹15,000), ESI (0.75% of Gross where Gross ≤ ₹21,000), VPF and NPS (10% Old / 14% New regime). The Payroll Register below is built directly from the PMS employee-master API — every employee is shown, live.',
  },
  {
    slug: 'rayontara', name: 'Rayontara', full: 'Rayontara', currency: 'INR',
    headcount: 15, white: 10, blue: 5, active: 15, resigned: 0, terminated: 0, source: 'live',
    notes: '<b>Rayontara</b> is a domestic (India) entity. The same statutory deduction rules as Koenig apply in full — EPF, ESI, VPF, NPS and PT (FR-17–FR-21). The Payroll Register below is built directly from the Salary Sheet you uploaded (11 salaried staff + 4 supporting staff = 15 employees), including bank account, IFSC, UAN and base location details as provided in the sheet.',
  },
  {
    slug: 'dubai', name: 'Dubai', full: 'Dubai-FZLLC', currency: 'AED',
    headcount: 0, white: 0, blue: 0, active: 0, resigned: 0, terminated: 0, source: 'sample',
    notes: '<b>Dubai-FZLLC</b> is a UAE free-zone entity. India-specific statutory deductions (EPF, ESI, PT) do not apply. Net payable is computed and disbursed in AED (FR-33). The Payroll Register below is built live from the PMS employee-master API — every employee whose entity/tag is FZLLC, or whose Payroll Processing Location resolves to a UAE city, is shown here (see README\'s "Overseas employee routing" section). Pay Scale (and the Salary derived from it) is also live from the Appraisal API.',
  },
  {
    slug: 'global', name: 'Global', full: 'Global-DMCC', currency: 'AED',
    headcount: 95, white: 95, blue: 0, active: 89, resigned: 4, terminated: 2, source: 'sample',
    notes: '<b>Global-DMCC</b> is the only entity eligible for WFH Reimbursement (FR-30 / BR-17) — any RMS-approved WFH amount for the payroll month is added to net salary. Global-DMCC also pays a subset of employees in USD alongside the standard AED payroll — use the currency toggle below to filter the register by payout currency. The Payroll Register below shows a sample of 8 of 95 employees.',
  },
  {
    slug: 'usa', name: 'USA', full: 'USA', currency: 'USD',
    headcount: 65, white: 65, blue: 0, active: 61, resigned: 3, terminated: 1, source: 'sample',
    notes: 'Net payable for <b>USA</b> is computed and disbursed in USD (FR-33). India-specific statutory deductions do not apply. The Payroll Register below is built live from the PMS employee-master API, showing overseas employees whose Payroll Processing Location resolves to a US city, with Pay Scale (and the Salary derived from it) also live from the Appraisal API.',
  },
  {
    slug: 'uk', name: 'UK', full: 'London', currency: 'GBP',
    headcount: 55, white: 55, blue: 0, active: 52, resigned: 2, terminated: 1, source: 'sample',
    notes: 'Net payable for <b>UK (London)</b> is computed and disbursed in GBP (FR-33). India-specific statutory deductions do not apply. The Payroll Register below is built live from the PMS employee-master API, showing overseas employees whose Payroll Processing Location resolves to a UK city, with Pay Scale (and the Salary derived from it) also live from the Appraisal API.',
  },
  {
    slug: 'newzealand', name: 'New Zealand', full: 'New Zealand', currency: 'NZD',
    headcount: 30, white: 30, blue: 0, active: 28, resigned: 1, terminated: 1, source: 'sample',
    notes: 'Net payable for <b>New Zealand</b> is computed and disbursed in NZD (FR-33). India-specific statutory deductions do not apply. The Payroll Register below is built live from the PMS employee-master API, showing overseas employees whose Payroll Processing Location resolves to a New Zealand city, with Pay Scale (and the Salary derived from it) also live from the Appraisal API.',
  },
  {
    slug: 'australia', name: 'Australia', full: 'Australia', currency: 'AUD',
    headcount: 45, white: 45, blue: 0, active: 42, resigned: 2, terminated: 1, source: 'sample',
    notes: 'Net payable for <b>Australia</b> is computed and disbursed in AUD (FR-33). India-specific statutory deductions do not apply. The Payroll Register below is built live from the PMS employee-master API, showing overseas employees whose Payroll Processing Location resolves to an Australian city, with Pay Scale (and the Salary derived from it) also live from the Appraisal API.',
  },
  {
    slug: 'malaysia', name: 'Malaysia', full: 'Malaysia', currency: 'MYR',
    headcount: 75, white: 75, blue: 0, active: 70, resigned: 3, terminated: 2, source: 'sample',
    notes: 'Net payable for <b>Malaysia</b> is computed and disbursed in MYR (FR-33). India-specific statutory deductions do not apply. The Payroll Register below is built live from the PMS employee-master API, showing overseas employees whose Payroll Processing Location resolves to a Malaysian city, with Pay Scale (and the Salary derived from it) also live from the Appraisal API.',
  },
  {
    slug: 'saudi', name: 'Saudi', full: 'Saudi Arabia', currency: 'SAR',
    headcount: 85, white: 85, blue: 0, active: 80, resigned: 3, terminated: 2, source: 'sample',
    notes: 'Net payable for <b>Saudi Arabia</b> is computed and disbursed in SAR (FR-33). India-specific statutory deductions do not apply. The Payroll Register below is built live from the PMS employee-master API, showing overseas employees whose Payroll Processing Location resolves to a Saudi city, with Pay Scale (and the Salary derived from it) also live from the Appraisal API.',
  },
  {
    slug: 'canada', name: 'Canada', full: 'Canada', currency: 'CAD',
    headcount: 40, white: 40, blue: 0, active: 37, resigned: 2, terminated: 1, source: 'sample',
    notes: 'Net payable for <b>Canada</b> is computed and disbursed in CAD (FR-33). India-specific statutory deductions do not apply. The Payroll Register below is built live from the PMS employee-master API, showing overseas employees whose Payroll Processing Location resolves to a Canadian city, with Pay Scale (and the Salary derived from it) also live from the Appraisal API.',
  },
];

export const bySlug: Record<string, Entity> = Object.fromEntries(ENTITIES.map((e) => [e.slug, e]));
export const TOTAL_EMPLOYEES = ENTITIES.reduce((a, e) => a + e.headcount, 0);
