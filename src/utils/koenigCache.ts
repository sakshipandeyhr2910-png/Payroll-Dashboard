import type { KoenigEmployeeRaw } from './koenigLiveApi';
import type { AppraisalRecord } from './rayontaraAppraisalApi';
import type { LoanAdvanceRecord } from './rayontaraLoanApi';
import type { MealAllowanceRecord } from './rayontaraMealApi';
import type { RecoveryRecord } from './rayontaraRecoveryApi';
import type { TdsRecord } from './rayontaraTdsApi';
import type { LeaveRecord } from './rayontaraLeaveApi';
import type { ArrearRecord } from './rayontaraArrearApi';

// Module-level (not component state) so it survives EntityPage unmounting — which happens every
// time you navigate away via Overview (App.tsx only renders EntityPage while an entity is
// selected, so leaving to Overview unmounts it entirely, wiping any component state). Caching
// here means clicking back into Koenig shows the already-fetched data immediately, with no
// reload/flicker and no re-hitting the PMS code-recovery scan — until refreshKoenigEmployeeList()
// is called explicitly (the "Update Employee List" action), which clears everything below so the
// next visit fetches fresh.
export interface KoenigCache {
  employees: KoenigEmployeeRaw[] | null;
  codeStats: { matched: number; total: number } | null;
  appraisal: AppraisalRecord[] | null;
  loans: LoanAdvanceRecord[] | null;
  meals: MealAllowanceRecord[] | null;
  arrear: ArrearRecord[] | null;
  recoveryByMonth: Map<string, RecoveryRecord[]>;
  tdsByMonth: Map<string, TdsRecord[]>;
  leaveByMonth: Map<string, LeaveRecord[]>;
}

export const koenigCache: KoenigCache = {
  employees: null,
  codeStats: null,
  appraisal: null,
  loans: null,
  meals: null,
  arrear: null,
  recoveryByMonth: new Map(),
  tdsByMonth: new Map(),
  leaveByMonth: new Map(),
};

export function refreshKoenigEmployeeList(): void {
  koenigCache.employees = null;
  koenigCache.codeStats = null;
  koenigCache.appraisal = null;
  koenigCache.loans = null;
  koenigCache.meals = null;
  koenigCache.arrear = null;
  koenigCache.recoveryByMonth = new Map();
  koenigCache.tdsByMonth = new Map();
  koenigCache.leaveByMonth = new Map();
}
