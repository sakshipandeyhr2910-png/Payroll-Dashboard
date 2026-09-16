import type { OverseasEmployeeRaw } from './overseasLiveApi';
import type { AppraisalRecord } from './rayontaraAppraisalApi';
import type { LoanAdvanceRecord } from './rayontaraLoanApi';
import type { ArrearRecord } from './rayontaraArrearApi';
import type { RecoveryRecord } from './rayontaraRecoveryApi';

// Same reasoning as utils/koenigCache.ts — module-level so it survives EntityPage unmounting on
// every navigation to Overview, until refreshOverseasEmployeeList() (the "Update Employee List"
// action, available on any of the 8 country tabs) clears it for a fresh fetch. One shared cache
// backs all 8 country-specific entity tabs (Dubai, USA, UK, New Zealand, Australia, Malaysia,
// Saudi, Canada) — single Appraisal/Loan/Arrear/Recovery fetches each cover every employee across
// all 8, same as the employee list itself, even though each field is currently only DISPLAYED on a
// subset of entities (Loan Amount/Appraisal Arrear on all 8; TA-DA/Recovery on Dubai only) per
// separate explicit requests — see the scoping flags in EntityPage.tsx. No Meal/TDS/Leave/WFH
// sub-caches since those integrations haven't been requested for any overseas entity.
export interface OverseasCache {
  employees: OverseasEmployeeRaw[] | null;
  codeStats: { matched: number; total: number } | null;
  appraisal: AppraisalRecord[] | null;
  loans: LoanAdvanceRecord[] | null;
  arrear: ArrearRecord[] | null;
  recoveryByMonth: Map<string, RecoveryRecord[]>;
}

export const overseasCache: OverseasCache = {
  employees: null,
  codeStats: null,
  appraisal: null,
  loans: null,
  arrear: null,
  recoveryByMonth: new Map(),
};

export function refreshOverseasEmployeeList(): void {
  overseasCache.employees = null;
  overseasCache.codeStats = null;
  overseasCache.appraisal = null;
  overseasCache.loans = null;
  overseasCache.arrear = null;
  overseasCache.recoveryByMonth = new Map();
}
