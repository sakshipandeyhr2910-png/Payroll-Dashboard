import type { PayrollRow } from '../types';

export interface PayrollColumn {
  key: keyof PayrollRow;
  label: string;
  num?: boolean;
  net?: boolean;
}

// Column layout matches the company's standard Salary Sheet template (Book1.xlsx) in order and
// naming — EmpCode/EmployeeName/DOJ/Designation/Basic/Hra/OtherAllowance/ClubSpecialAllowance/
// Salary/WorkingDaysPerWeek/PresentDays/TotalDays (labeled "Total Working Days" per explicit
// request)/TotalDaysAfterLeaveTaken/PayScale/PF/ESI/LoanAmt/TDS/NPS/Arrear/VPF/TADA/Recovery/
// ProfessionalTax/AppraisalArrear/MealPasses/NetPayable/SalaryHold/BankAccNo/IFCSCode/BankName/
// UAN/BaseLocation (the sheet's own SalaryHoldNew, EPF and AdvanceAmt columns were all dropped
// per explicit request). Emp Code + Employee Name render separately in the frozen pane (see
// PayrollTable). Category, Overtime, DA, WFH Reimbursement, Commission, Currency and Remarks
// aren't part of that template — they're kept as additional columns since they're working
// features from earlier explicit requests (category filtering, overtime eligibility, WFH
// reimbursement, sales commission, multi-currency, deduction-error flags), not part of the
// sheet. Commission sits right after Meal Passes per explicit request, rather than near the end
// with the other non-template columns. Half Days and Late Marks (also not part of the sheet)
// were dropped per explicit request — they had no tracked data source and always showed 0 —
// replaced by the single computed Leave Days column.
export const PAYROLL_COLS: PayrollColumn[] = [
  { key: 'designation', label: 'Designation' },
  { key: 'category', label: 'Category' },
  { key: 'doj', label: 'Date of Joining' },
  { key: 'basic', label: 'Basic', num: true },
  { key: 'hra', label: 'HRA', num: true },
  { key: 'allowance', label: 'Other Allowance', num: true },
  { key: 'clubSpecialAllowance', label: 'Club/Special Allowance', num: true },
  { key: 'gross', label: 'Salary', num: true },
  { key: 'workingDaysPerWeek', label: 'Working Days Per Week', num: true },
  { key: 'presentDays', label: 'Present Days', num: true },
  { key: 'leaveDays', label: 'Leave Days', num: true },
  { key: 'totalDays', label: 'Total Working Days', num: true },
  { key: 'totalDaysAfterLeaveTaken', label: 'Total Days After Leave Taken', num: true },
  { key: 'payScale', label: 'Pay Scale' },
  { key: 'pf', label: 'PF', num: true },
  { key: 'esi', label: 'ESI', num: true },
  { key: 'loan', label: 'Loan Amount', num: true },
  { key: 'tds', label: 'TDS', num: true },
  { key: 'nps', label: 'NPS', num: true },
  { key: 'arrear', label: 'Arrear', num: true },
  { key: 'overtime', label: 'Overtime', num: true },
  { key: 'da', label: 'DA', num: true },
  { key: 'vpf', label: 'VPF', num: true },
  { key: 'tada', label: 'TA/DA', num: true },
  { key: 'recovery', label: 'Recovery', num: true },
  { key: 'pt', label: 'Professional Tax', num: true },
  { key: 'appraisalArrear', label: 'Appraisal Arrear', num: true },
  { key: 'wfh', label: 'WFH Reimbursement', num: true },
  { key: 'mealpass', label: 'Meal Passes', num: true },
  { key: 'commission', label: 'Commission', num: true },
  { key: 'net', label: 'Net Payable', num: true, net: true },
  { key: 'salaryHold', label: 'Salary Hold' },
  { key: 'bankacc', label: 'Bank Account No.' },
  { key: 'ifsc', label: 'IFSC Code' },
  { key: 'bankname', label: 'Bank Name' },
  { key: 'uan', label: 'UAN' },
  { key: 'location', label: 'Base Location' },
  { key: 'currency', label: 'Currency' },
  { key: 'remarks', label: 'Remarks' },
];

// Columns rendered as plain text (no numeric formatting; blank/undefined renders as a dash)
export const TEXT_FALLBACK_COLS = new Set<keyof PayrollRow>([
  'designation', 'currency', 'uan', 'bankname', 'bankacc', 'ifsc', 'location',
  'doj', 'payScale', 'salaryHold',
]);
