import type { GlobalEmployeeRaw } from './globalLiveApi';
import type { AppraisalRecord } from './rayontaraAppraisalApi';
import type { LoanAdvanceRecord } from './rayontaraLoanApi';
import type { MealAllowanceRecord } from './rayontaraMealApi';
import type { RecoveryRecord } from './rayontaraRecoveryApi';
import type { TdsRecord } from './rayontaraTdsApi';

// Same reasoning as utils/koenigCache.ts — module-level so it survives EntityPage unmounting on
// every navigation to Overview, until refreshGlobalEmployeeList() (the Global "Update Employee
// List" action) clears it for a fresh fetch.
export interface GlobalCache {
  employees: GlobalEmployeeRaw[] | null;
  codeStats: { matched: number; total: number } | null;
  appraisal: AppraisalRecord[] | null;
  loans: LoanAdvanceRecord[] | null;
  meals: MealAllowanceRecord[] | null;
  recoveryByMonth: Map<string, RecoveryRecord[]>;
  tdsByMonth: Map<string, TdsRecord[]>;
}

export const globalCache: GlobalCache = {
  employees: null,
  codeStats: null,
  appraisal: null,
  loans: null,
  meals: null,
  recoveryByMonth: new Map(),
  tdsByMonth: new Map(),
};

export function refreshGlobalEmployeeList(): void {
  globalCache.employees = null;
  globalCache.codeStats = null;
  globalCache.appraisal = null;
  globalCache.loans = null;
  globalCache.meals = null;
  globalCache.recoveryByMonth = new Map();
  globalCache.tdsByMonth = new Map();
}
