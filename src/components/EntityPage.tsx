import { useEffect, useMemo, useRef, useState } from 'react';
import type { Entity, CategoryFilter, PayrollRow } from '../types';
import { ENTITY_ROWS } from '../data/entityRows';
import { PAYROLL_COLS } from '../data/payrollColumns';
import { fmt, toCalcNumber } from '../utils/format';
import { BASE_MONTH, monthLabel, sampleFactor, applyMonthFactor, isMonthCompleted } from '../utils/month';
import { fetchSnapshot, saveSnapshot } from '../utils/snapshotApi';
import { weekdaysInMonth, presentDaysForMonth, hasJoinedByMonth } from '../utils/attendance';
import { professionalTaxForLocation } from '../utils/professionalTax';
import { downloadXlsx } from '../utils/xlsxExport';
import { fetchRayontaraLiveEmployees, type PmsEmployee } from '../utils/rayontaraLiveApi';
import { fetchRayontaraAppraisal, type AppraisalRecord } from '../utils/rayontaraAppraisalApi';
import { fetchRayontaraLoans, type LoanAdvanceRecord } from '../utils/rayontaraLoanApi';
import { totalLoanDeductionForMonth } from '../utils/loanDeduction';
import { fetchRayontaraMealAllowances, type MealAllowanceRecord } from '../utils/rayontaraMealApi';
import { fetchRayontaraRecovery, type RecoveryRecord } from '../utils/rayontaraRecoveryApi';
import { fetchRayontaraTds, type TdsRecord } from '../utils/rayontaraTdsApi';
import { fetchRayontaraLeave, type LeaveRecord } from '../utils/rayontaraLeaveApi';
import { fetchRayontaraArrear, type ArrearRecord } from '../utils/rayontaraArrearApi';
import { appraisalArrearForMonth, payScaleForMonth } from '../utils/arrearCalculation';
import { buildRayontaraLiveRows } from '../utils/rayontaraLiveRows';
import { fetchKoenigLiveEmployees, type KoenigEmployeeRaw } from '../utils/koenigLiveApi';
import { fetchKoenigAppraisal } from '../utils/koenigAppraisalApi';
import { fetchKoenigLoans } from '../utils/koenigLoanApi';
import { fetchKoenigTds } from '../utils/koenigTdsApi';
import { fetchKoenigLeave } from '../utils/koenigLeaveApi';
import { fetchKoenigRecovery } from '../utils/koenigRecoveryApi';
import { fetchKoenigArrear } from '../utils/koenigArrearApi';
import { buildKoenigLiveRows } from '../utils/koenigLiveRows';
import { koenigCache, refreshKoenigEmployeeList } from '../utils/koenigCache';
import { fetchGlobalLiveEmployees, type GlobalEmployeeRaw } from '../utils/globalLiveApi';
import { fetchGlobalWfhReimbursements, type WfhReimbursementRecord } from '../utils/globalWfhApi';
import { globalCache, refreshGlobalEmployeeList } from '../utils/globalCache';
import { fetchOverseasLiveEmployees, type OverseasEmployeeRaw } from '../utils/overseasLiveApi';
import { overseasCache, refreshOverseasEmployeeList } from '../utils/overseasCache';
import { buildOverseasLiveRows } from '../utils/overseasLiveRows';
import { classifyOverseasEmployee, OVERSEAS_ENTITY_SLUGS, type OverseasEntitySlug } from '../utils/overseasEntityMapping';
import MonthControl from './MonthControl';
import CategoryChips from './CategoryChips';
import CurrencyChips, { type CurrencyFilterValue } from './CurrencyChips';
import PayrollTable from './PayrollTable';

// Explicit per-employee entity override, same "confirmed exception, not a policy change" reasoning
// as CURRENCY_CORRECTIONS in koenigLiveRows.ts. Imran Sheikh (3287) is Global population in PMS
// (Is_global=true, city Berlin) and was deliberately left there earlier when live location data
// contradicted a Dubai claim — but per explicit confirmation he actually processes under Dubai
// (consistent with his Appraisal record's currency also having been wrong, already corrected
// separately). His row is pulled out of Global and appended to Dubai specifically; no other
// overseas/Global employee is affected, and PMS-driven routing (classifyOverseasEmployee) is
// unchanged.
const EMPLOYEE_ENTITY_OVERRIDE: Record<number, string> = {
  3287: 'dubai',
};

interface Props {
  entity: Entity;
  categoryFilter: CategoryFilter;
  onCategoryFilterChange: (f: CategoryFilter) => void;
  currencyFilter: CurrencyFilterValue;
  onCurrencyFilterChange: (f: CurrencyFilterValue) => void;
  selectedMonth: string;
  onSelectedMonthChange: (m: string) => void;
}

export default function EntityPage({
  entity,
  categoryFilter,
  onCategoryFilterChange,
  currencyFilter,
  onCurrencyFilterChange,
  selectedMonth,
  onSelectedMonthChange,
}: Props) {
  const isBaseMonth = selectedMonth === BASE_MONTH;
  const staticRows = ENTITY_ROWS[entity.slug] || [];

  // Rayontara's Payroll Register is built from two independent live sources: the PMS
  // employee-details API (name, designation, bank details, DOJ, UAN, location) and the
  // Appraisal API (Pay Scale amount, NPS shares). Neither provides Basic/HRA/Gross/other
  // deductions at all, so those columns still render as "—" (see utils/rayontaraLiveRows.ts).
  // The two fetches are independent so a failure in one (e.g. Appraisal API down) degrades only
  // its own columns to "—" rather than blocking the employee-details rows entirely.
  const RAYONTARA_LIVE_SYNC_ENABLED = true;
  const [liveEmployees, setLiveEmployees] = useState<PmsEmployee[] | null>(null);
  const [liveAppraisal, setLiveAppraisal] = useState<AppraisalRecord[] | null>(null);
  const [liveLoans, setLiveLoans] = useState<LoanAdvanceRecord[] | null>(null);
  const [liveMeals, setLiveMeals] = useState<MealAllowanceRecord[] | null>(null);
  const [liveArrear, setLiveArrear] = useState<ArrearRecord[] | null>(null);
  const [liveLoading, setLiveLoading] = useState(false);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [appraisalError, setAppraisalError] = useState<string | null>(null);
  const [loanError, setLoanError] = useState<string | null>(null);
  const [mealError, setMealError] = useState<string | null>(null);
  const [arrearError, setArrearError] = useState<string | null>(null);

  useEffect(() => {
    if (!RAYONTARA_LIVE_SYNC_ENABLED || entity.slug !== 'rayontara') {
      setLiveEmployees(null);
      setLiveAppraisal(null);
      setLiveLoans(null);
      setLiveMeals(null);
      setLiveArrear(null);
      setLiveError(null);
      setAppraisalError(null);
      setLoanError(null);
      setMealError(null);
      setArrearError(null);
      setLiveLoading(false);
      return;
    }
    let cancelled = false;
    setLiveLoading(true);
    setLiveError(null);
    setAppraisalError(null);
    setLoanError(null);
    setMealError(null);
    setArrearError(null);
    Promise.all([
      fetchRayontaraLiveEmployees(),
      fetchRayontaraAppraisal(),
      fetchRayontaraLoans(),
      fetchRayontaraMealAllowances(),
      fetchRayontaraArrear(),
    ]).then(([empResult, appraisalResult, loanResult, mealResult, arrearResult]) => {
      if (cancelled) return;
      setLiveLoading(false);
      if (empResult.ok) {
        setLiveEmployees(empResult.employees);
      } else {
        setLiveEmployees(null);
        setLiveError(empResult.error);
      }
      if (appraisalResult.ok) {
        setLiveAppraisal(appraisalResult.records);
      } else {
        setLiveAppraisal(null);
        setAppraisalError(appraisalResult.error);
      }
      if (loanResult.ok) {
        setLiveLoans(loanResult.records);
      } else {
        setLiveLoans(null);
        setLoanError(loanResult.error);
      }
      if (mealResult.ok) {
        setLiveMeals(mealResult.records);
      } else {
        setLiveMeals(null);
        setMealError(mealResult.error);
      }
      if (arrearResult.ok) {
        setLiveArrear(arrearResult.records);
      } else {
        setLiveArrear(null);
        setArrearError(arrearResult.error);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [entity.slug]);

  // The Recovery Panel API is month-scoped (each deduction belongs to a specific payroll month),
  // unlike the other three sources — so it needs its own effect keyed on selectedMonth, refetching
  // whenever the user steps to a different month rather than only once per entity view.
  const [liveRecovery, setLiveRecovery] = useState<RecoveryRecord[] | null>(null);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);

  useEffect(() => {
    if (!RAYONTARA_LIVE_SYNC_ENABLED || entity.slug !== 'rayontara') {
      setLiveRecovery(null);
      setRecoveryError(null);
      return;
    }
    let cancelled = false;
    setRecoveryError(null);
    fetchRayontaraRecovery(selectedMonth).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setLiveRecovery(result.records);
      } else {
        setLiveRecovery(null);
        setRecoveryError(result.error);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [entity.slug, selectedMonth]);

  // Employee TDS Details is also month-scoped, per employee code — a blank query returns nothing
  // (confirmed live), but a specific EmpCode returns that employee's full monthly TDS history, so
  // this needs re-fetching whenever the month changes, same reasoning as Recovery above.
  const [liveTds, setLiveTds] = useState<TdsRecord[] | null>(null);
  const [tdsError, setTdsError] = useState<string | null>(null);

  useEffect(() => {
    if (!RAYONTARA_LIVE_SYNC_ENABLED || entity.slug !== 'rayontara') {
      setLiveTds(null);
      setTdsError(null);
      return;
    }
    let cancelled = false;
    setTdsError(null);
    fetchRayontaraTds(selectedMonth).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setLiveTds(result.records);
      } else {
        setLiveTds(null);
        setTdsError(result.error);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [entity.slug, selectedMonth]);

  // Employee Leave Details is also month-scoped, per employee code — requires both a specific
  // EmpCode AND a specific Month in the request itself (unlike TDS/Recovery, which filter
  // client-side), so this needs re-fetching whenever the month changes, same reasoning as above.
  const [liveLeave, setLiveLeave] = useState<LeaveRecord[] | null>(null);
  const [leaveError, setLeaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!RAYONTARA_LIVE_SYNC_ENABLED || entity.slug !== 'rayontara') {
      setLiveLeave(null);
      setLeaveError(null);
      return;
    }
    let cancelled = false;
    setLeaveError(null);
    fetchRayontaraLeave(selectedMonth).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setLiveLeave(result.records);
      } else {
        setLiveLeave(null);
        setLeaveError(result.error);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [entity.slug, selectedMonth]);

  // Everything Koenig-related below is cached at module level (utils/koenigCache.ts), not just in
  // component state — App.tsx unmounts EntityPage entirely whenever you navigate to Overview (it
  // only renders EntityPage while an entity is selected), which would otherwise wipe all of this
  // and force a full re-fetch/re-scan on every return visit. Lazy-initializing state straight from
  // the cache means a cached visit renders correctly on the very first paint, with no reload
  // flicker and no stale placeholder numbers. koenigRefreshTrigger is the only way any of these
  // effects re-fetch once cached — bumped exclusively by the explicit "Update Employee List"
  // action below, which also clears the cache first.
  const [koenigRefreshTrigger, setKoenigRefreshTrigger] = useState(0);

  // Koenig shares the same PMS credentials/token cache as Rayontara (see
  // vite-plugins/rayontaraApiPlugin.ts), but hits a bulk endpoint that classifies employees using
  // the API's own Is_rayontara / Is_oversease flags (Koenig = both false) rather than a known
  // code list. The bulk response itself never carries an Emp Code — it's recovered server-side by
  // scanning the per-code endpoint and matching back by exact full name, only when that name is
  // unique on both sides (koenigCodeStats tracks how many employees got a confident match).
  const [koenigEmployees, setKoenigEmployees] = useState<KoenigEmployeeRaw[] | null>(() => koenigCache.employees);
  const [koenigLoading, setKoenigLoading] = useState(false);
  const [koenigError, setKoenigError] = useState<string | null>(null);
  const [koenigCodeStats, setKoenigCodeStats] = useState<{ matched: number; total: number } | null>(
    () => koenigCache.codeStats,
  );

  useEffect(() => {
    if (entity.slug !== 'koenig') return;
    // Always refetches from the backend on every visit to this tab — no client-side "skip if
    // already cached" shortcut. koenigCache still exists purely so the previous fetch's data stays
    // on screen (rather than flashing empty) while this fresh one is in flight; it's written to
    // below, never read to decide whether to fetch.
    let cancelled = false;
    setKoenigLoading(true);
    setKoenigError(null);
    // koenigRefreshTrigger only increments via the explicit "Update Employee List" click (see
    // refreshKoenigEmployeeList's comment) — > 0 here means this run was caused by that click,
    // not the initial page load, so it's the one case that should force the server to redo its
    // otherwise-permanently-cached code-matching scan too (see fetchKoenigLiveEmployees).
    fetchKoenigLiveEmployees(koenigRefreshTrigger > 0).then((result) => {
      if (cancelled) return;
      setKoenigLoading(false);
      if (result.ok) {
        koenigCache.employees = result.employees;
        koenigCache.codeStats = { matched: result.matched, total: result.total };
        setKoenigEmployees(result.employees);
        setKoenigCodeStats({ matched: result.matched, total: result.total });
      } else {
        setKoenigEmployees(null);
        setKoenigCodeStats(null);
        setKoenigError(result.error);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [entity.slug, koenigRefreshTrigger]);

  // Employee Recovery Details is both per-employee-code AND month-scoped, same shape as TDS/Leave
  // above — cached per month, keyed on the same koenigEmployees codes. (The plugin previously did
  // a single blank/bulk query, which the live API always returned empty for — it requires a
  // specific EmpCode, same as every other per-employee Kites endpoint.)
  const [koenigRecovery, setKoenigRecovery] = useState<RecoveryRecord[] | null>(
    () => koenigCache.recoveryByMonth.get(selectedMonth) ?? null,
  );
  const [koenigRecoveryError, setKoenigRecoveryError] = useState<string | null>(null);

  useEffect(() => {
    if (entity.slug !== 'koenig' || !koenigEmployees) return;
    const cached = koenigCache.recoveryByMonth.get(selectedMonth);
    if (cached !== undefined) {
      setKoenigRecovery(cached);
      setKoenigRecoveryError(null);
      return;
    }
    const codes = koenigEmployees
      .map((e) => e.code)
      .filter((c): c is number => c !== null);
    if (codes.length === 0) {
      koenigCache.recoveryByMonth.set(selectedMonth, []);
      setKoenigRecovery([]);
      setKoenigRecoveryError(null);
      return;
    }
    let cancelled = false;
    setKoenigRecoveryError(null);
    fetchKoenigRecovery(codes, selectedMonth).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        koenigCache.recoveryByMonth.set(selectedMonth, result.records);
        setKoenigRecovery(result.records);
      } else {
        setKoenigRecovery(null);
        setKoenigRecoveryError(result.error);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [entity.slug, koenigEmployees, selectedMonth, koenigRefreshTrigger]);

  // Fires once koenigEmployees resolves — only rows that got a real Emp Code from the scan above
  // can be looked up here, so this waits on that result rather than running independently.
  const [koenigAppraisal, setKoenigAppraisal] = useState<AppraisalRecord[] | null>(() => koenigCache.appraisal);
  const [koenigAppraisalLoading, setKoenigAppraisalLoading] = useState(false);
  const [koenigAppraisalError, setKoenigAppraisalError] = useState<string | null>(null);

  useEffect(() => {
    if (entity.slug !== 'koenig' || !koenigEmployees) return;
    if (koenigCache.appraisal !== null) {
      setKoenigAppraisal(koenigCache.appraisal);
      setKoenigAppraisalError(null);
      setKoenigAppraisalLoading(false);
      return;
    }
    const codes = koenigEmployees
      .map((e) => e.code)
      .filter((c): c is number => c !== null);
    if (codes.length === 0) {
      koenigCache.appraisal = [];
      setKoenigAppraisal([]);
      setKoenigAppraisalError(null);
      setKoenigAppraisalLoading(false);
      return;
    }
    let cancelled = false;
    setKoenigAppraisalLoading(true);
    setKoenigAppraisalError(null);
    fetchKoenigAppraisal(codes).then((result) => {
      if (cancelled) return;
      setKoenigAppraisalLoading(false);
      if (result.ok) {
        koenigCache.appraisal = result.records;
        setKoenigAppraisal(result.records);
      } else {
        setKoenigAppraisal(null);
        setKoenigAppraisalError(result.error);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [entity.slug, koenigEmployees, koenigRefreshTrigger]);

  // Loan Advance is per-employee-code (a blank query returns nothing — confirmed live, same as
  // Appraisal), so it waits on koenigEmployees the same way the Appraisal effect above does.
  const [koenigLoans, setKoenigLoans] = useState<LoanAdvanceRecord[] | null>(() => koenigCache.loans);
  const [koenigLoanLoading, setKoenigLoanLoading] = useState(false);
  const [koenigLoanError, setKoenigLoanError] = useState<string | null>(null);

  useEffect(() => {
    if (entity.slug !== 'koenig' || !koenigEmployees) return;
    if (koenigCache.loans !== null) {
      setKoenigLoans(koenigCache.loans);
      setKoenigLoanError(null);
      setKoenigLoanLoading(false);
      return;
    }
    const codes = koenigEmployees
      .map((e) => e.code)
      .filter((c): c is number => c !== null);
    if (codes.length === 0) {
      koenigCache.loans = [];
      setKoenigLoans([]);
      setKoenigLoanError(null);
      setKoenigLoanLoading(false);
      return;
    }
    let cancelled = false;
    setKoenigLoanLoading(true);
    setKoenigLoanError(null);
    fetchKoenigLoans(codes).then((result) => {
      if (cancelled) return;
      setKoenigLoanLoading(false);
      if (result.ok) {
        koenigCache.loans = result.records;
        setKoenigLoans(result.records);
      } else {
        setKoenigLoans(null);
        setKoenigLoanError(result.error);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [entity.slug, koenigEmployees, koenigRefreshTrigger]);

  // Appraisal Arrear (GetLastTwoAppraisals) is per-employee-code, same as Loan/Appraisal, and not
  // month-scoped either — the raw new/old salary + dates are fetched once, and
  // appraisalArrearForMonth derives whichever month (if any) the arrear should show in.
  const [koenigArrear, setKoenigArrear] = useState<ArrearRecord[] | null>(() => koenigCache.arrear);
  const [koenigArrearLoading, setKoenigArrearLoading] = useState(false);
  const [koenigArrearError, setKoenigArrearError] = useState<string | null>(null);

  useEffect(() => {
    if (entity.slug !== 'koenig' || !koenigEmployees) return;
    if (koenigCache.arrear !== null) {
      setKoenigArrear(koenigCache.arrear);
      setKoenigArrearError(null);
      setKoenigArrearLoading(false);
      return;
    }
    const codes = koenigEmployees
      .map((e) => e.code)
      .filter((c): c is number => c !== null);
    if (codes.length === 0) {
      koenigCache.arrear = [];
      setKoenigArrear([]);
      setKoenigArrearError(null);
      setKoenigArrearLoading(false);
      return;
    }
    let cancelled = false;
    setKoenigArrearLoading(true);
    setKoenigArrearError(null);
    fetchKoenigArrear(codes).then((result) => {
      if (cancelled) return;
      setKoenigArrearLoading(false);
      if (result.ok) {
        koenigCache.arrear = result.records;
        setKoenigArrear(result.records);
      } else {
        setKoenigArrear(null);
        setKoenigArrearError(result.error);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [entity.slug, koenigEmployees, koenigRefreshTrigger]);

  // Employee TDS Details is both per-employee-code (like Loan/Appraisal) AND month-scoped (like
  // Recovery) — cached per month, keyed on the same koenigEmployees codes.
  const [koenigTds, setKoenigTds] = useState<TdsRecord[] | null>(
    () => koenigCache.tdsByMonth.get(selectedMonth) ?? null,
  );
  const [koenigTdsLoading, setKoenigTdsLoading] = useState(false);
  const [koenigTdsError, setKoenigTdsError] = useState<string | null>(null);

  useEffect(() => {
    if (entity.slug !== 'koenig' || !koenigEmployees) return;
    const cached = koenigCache.tdsByMonth.get(selectedMonth);
    if (cached !== undefined) {
      setKoenigTds(cached);
      setKoenigTdsError(null);
      setKoenigTdsLoading(false);
      return;
    }
    const codes = koenigEmployees
      .map((e) => e.code)
      .filter((c): c is number => c !== null);
    if (codes.length === 0) {
      koenigCache.tdsByMonth.set(selectedMonth, []);
      setKoenigTds([]);
      setKoenigTdsError(null);
      setKoenigTdsLoading(false);
      return;
    }
    let cancelled = false;
    setKoenigTdsLoading(true);
    setKoenigTdsError(null);
    fetchKoenigTds(codes, selectedMonth).then((result) => {
      if (cancelled) return;
      setKoenigTdsLoading(false);
      if (result.ok) {
        koenigCache.tdsByMonth.set(selectedMonth, result.records);
        setKoenigTds(result.records);
      } else {
        setKoenigTds(null);
        setKoenigTdsError(result.error);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [entity.slug, koenigEmployees, selectedMonth, koenigRefreshTrigger]);

  // Employee Leave Details is both per-employee-code AND month-scoped, same shape as TDS above —
  // cached per month, keyed on the same koenigEmployees codes.
  const [koenigLeave, setKoenigLeave] = useState<LeaveRecord[] | null>(
    () => koenigCache.leaveByMonth.get(selectedMonth) ?? null,
  );
  const [koenigLeaveLoading, setKoenigLeaveLoading] = useState(false);
  const [koenigLeaveError, setKoenigLeaveError] = useState<string | null>(null);

  useEffect(() => {
    if (entity.slug !== 'koenig' || !koenigEmployees) return;
    const cached = koenigCache.leaveByMonth.get(selectedMonth);
    if (cached !== undefined) {
      setKoenigLeave(cached);
      setKoenigLeaveError(null);
      setKoenigLeaveLoading(false);
      return;
    }
    const codes = koenigEmployees
      .map((e) => e.code)
      .filter((c): c is number => c !== null);
    if (codes.length === 0) {
      koenigCache.leaveByMonth.set(selectedMonth, []);
      setKoenigLeave([]);
      setKoenigLeaveError(null);
      setKoenigLeaveLoading(false);
      return;
    }
    let cancelled = false;
    setKoenigLeaveLoading(true);
    setKoenigLeaveError(null);
    fetchKoenigLeave(codes, selectedMonth).then((result) => {
      if (cancelled) return;
      setKoenigLeaveLoading(false);
      if (result.ok) {
        koenigCache.leaveByMonth.set(selectedMonth, result.records);
        setKoenigLeave(result.records);
      } else {
        setKoenigLeave(null);
        setKoenigLeaveError(result.error);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [entity.slug, koenigEmployees, selectedMonth, koenigRefreshTrigger]);

  // Pluxee Meal Card is a company-wide bulk query (no per-employee-code request needed) — fires
  // as soon as Koenig is selected, independent of the Emp Code recovery scan.
  const [koenigMeals, setKoenigMeals] = useState<MealAllowanceRecord[] | null>(() => koenigCache.meals);
  const [koenigMealError, setKoenigMealError] = useState<string | null>(null);

  useEffect(() => {
    if (entity.slug !== 'koenig') return;
    if (koenigCache.meals !== null) {
      setKoenigMeals(koenigCache.meals);
      setKoenigMealError(null);
      return;
    }
    let cancelled = false;
    setKoenigMealError(null);
    fetchRayontaraMealAllowances().then((mealResult) => {
      if (cancelled) return;
      if (mealResult.ok) {
        koenigCache.meals = mealResult.records;
        setKoenigMeals(mealResult.records);
      } else {
        setKoenigMeals(null);
        setKoenigMealError(mealResult.error);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [entity.slug, koenigRefreshTrigger]);

  // Global mirrors Koenig's entire live pipeline (employee-master + Appraisal + Loan + TDS +
  // Meal + Recovery), just classified by the PMS API's Is_global flag instead of
  // Is_rayontara/Is_oversease (see vite-plugins/rayontaraApiPlugin.ts). The Appraisal/Loan/TDS
  // per-code endpoints and the Meal/Recovery bulk endpoints are all generic — they answer for
  // whatever Emp Codes are sent, regardless of which entity's UI is asking — so the same
  // fetchKoenig*/fetchRayontara* client functions are reused here rather than duplicating a
  // parallel set of API routes for Global's codes.
  const [globalRefreshTrigger, setGlobalRefreshTrigger] = useState(0);

  const [globalEmployees, setGlobalEmployees] = useState<GlobalEmployeeRaw[] | null>(() => globalCache.employees);
  const [globalLoading, setGlobalLoading] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [globalCodeStats, setGlobalCodeStats] = useState<{ matched: number; total: number } | null>(
    () => globalCache.codeStats,
  );

  useEffect(() => {
    // Also fetched on the Dubai tab: EMPLOYEE_ENTITY_OVERRIDE needs Imran Sheikh's (3287) master
    // record, which only exists in the Global population, to render his row there.
    if (entity.slug !== 'global' && entity.slug !== 'dubai') return;
    // Always refetches from the backend on every visit — see the Koenig effect above for why the
    // cache-based "skip if already fetched" shortcut was removed.
    let cancelled = false;
    setGlobalLoading(true);
    setGlobalError(null);
    // Only an explicit "Update Employee List" click (globalRefreshTrigger > 0) should force the
    // server to redo its cached code-matching scan.
    fetchGlobalLiveEmployees(globalRefreshTrigger > 0).then((result) => {
      if (cancelled) return;
      setGlobalLoading(false);
      if (result.ok) {
        globalCache.employees = result.employees;
        globalCache.codeStats = { matched: result.matched, total: result.total };
        setGlobalEmployees(result.employees);
        setGlobalCodeStats({ matched: result.matched, total: result.total });
      } else {
        setGlobalEmployees(null);
        setGlobalCodeStats(null);
        setGlobalError(result.error);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [entity.slug, globalRefreshTrigger]);

  const [globalAppraisal, setGlobalAppraisal] = useState<AppraisalRecord[] | null>(() => globalCache.appraisal);
  const [globalAppraisalLoading, setGlobalAppraisalLoading] = useState(false);
  const [globalAppraisalError, setGlobalAppraisalError] = useState<string | null>(null);

  useEffect(() => {
    // Also needed on Dubai — see EMPLOYEE_ENTITY_OVERRIDE (Imran Sheikh's Pay Scale/currency).
    if ((entity.slug !== 'global' && entity.slug !== 'dubai') || !globalEmployees) return;
    if (globalCache.appraisal !== null) {
      setGlobalAppraisal(globalCache.appraisal);
      setGlobalAppraisalError(null);
      setGlobalAppraisalLoading(false);
      return;
    }
    const codes = globalEmployees.map((e) => e.code).filter((c): c is number => c !== null);
    if (codes.length === 0) {
      globalCache.appraisal = [];
      setGlobalAppraisal([]);
      setGlobalAppraisalError(null);
      setGlobalAppraisalLoading(false);
      return;
    }
    let cancelled = false;
    setGlobalAppraisalLoading(true);
    setGlobalAppraisalError(null);
    fetchKoenigAppraisal(codes).then((result) => {
      if (cancelled) return;
      setGlobalAppraisalLoading(false);
      if (result.ok) {
        globalCache.appraisal = result.records;
        setGlobalAppraisal(result.records);
      } else {
        setGlobalAppraisal(null);
        setGlobalAppraisalError(result.error);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [entity.slug, globalEmployees, globalRefreshTrigger]);

  const [globalLoans, setGlobalLoans] = useState<LoanAdvanceRecord[] | null>(() => globalCache.loans);
  const [globalLoanLoading, setGlobalLoanLoading] = useState(false);
  const [globalLoanError, setGlobalLoanError] = useState<string | null>(null);

  useEffect(() => {
    // Also needed on Dubai — see EMPLOYEE_ENTITY_OVERRIDE (Imran Sheikh's Loan Amount).
    if ((entity.slug !== 'global' && entity.slug !== 'dubai') || !globalEmployees) return;
    if (globalCache.loans !== null) {
      setGlobalLoans(globalCache.loans);
      setGlobalLoanError(null);
      setGlobalLoanLoading(false);
      return;
    }
    const codes = globalEmployees.map((e) => e.code).filter((c): c is number => c !== null);
    if (codes.length === 0) {
      globalCache.loans = [];
      setGlobalLoans([]);
      setGlobalLoanError(null);
      setGlobalLoanLoading(false);
      return;
    }
    let cancelled = false;
    setGlobalLoanLoading(true);
    setGlobalLoanError(null);
    fetchKoenigLoans(codes).then((result) => {
      if (cancelled) return;
      setGlobalLoanLoading(false);
      if (result.ok) {
        globalCache.loans = result.records;
        setGlobalLoans(result.records);
      } else {
        setGlobalLoans(null);
        setGlobalLoanError(result.error);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [entity.slug, globalEmployees, globalRefreshTrigger]);

  const [globalTds, setGlobalTds] = useState<TdsRecord[] | null>(
    () => globalCache.tdsByMonth.get(selectedMonth) ?? null,
  );
  const [globalTdsLoading, setGlobalTdsLoading] = useState(false);
  const [globalTdsError, setGlobalTdsError] = useState<string | null>(null);

  useEffect(() => {
    if (entity.slug !== 'global' || !globalEmployees) return;
    const cached = globalCache.tdsByMonth.get(selectedMonth);
    if (cached !== undefined) {
      setGlobalTds(cached);
      setGlobalTdsError(null);
      setGlobalTdsLoading(false);
      return;
    }
    const codes = globalEmployees.map((e) => e.code).filter((c): c is number => c !== null);
    if (codes.length === 0) {
      globalCache.tdsByMonth.set(selectedMonth, []);
      setGlobalTds([]);
      setGlobalTdsError(null);
      setGlobalTdsLoading(false);
      return;
    }
    let cancelled = false;
    setGlobalTdsLoading(true);
    setGlobalTdsError(null);
    fetchKoenigTds(codes, selectedMonth).then((result) => {
      if (cancelled) return;
      setGlobalTdsLoading(false);
      if (result.ok) {
        globalCache.tdsByMonth.set(selectedMonth, result.records);
        setGlobalTds(result.records);
      } else {
        setGlobalTds(null);
        setGlobalTdsError(result.error);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [entity.slug, globalEmployees, selectedMonth, globalRefreshTrigger]);

  const [globalMeals, setGlobalMeals] = useState<MealAllowanceRecord[] | null>(() => globalCache.meals);
  const [globalMealError, setGlobalMealError] = useState<string | null>(null);

  useEffect(() => {
    if (entity.slug !== 'global') return;
    if (globalCache.meals !== null) {
      setGlobalMeals(globalCache.meals);
      setGlobalMealError(null);
      return;
    }
    let cancelled = false;
    setGlobalMealError(null);
    fetchRayontaraMealAllowances().then((mealResult) => {
      if (cancelled) return;
      if (mealResult.ok) {
        globalCache.meals = mealResult.records;
        setGlobalMeals(mealResult.records);
      } else {
        setGlobalMeals(null);
        setGlobalMealError(mealResult.error);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [entity.slug, globalRefreshTrigger]);

  const [globalRecovery, setGlobalRecovery] = useState<RecoveryRecord[] | null>(
    () => globalCache.recoveryByMonth.get(selectedMonth) ?? null,
  );
  const [globalRecoveryError, setGlobalRecoveryError] = useState<string | null>(null);

  useEffect(() => {
    // Also needed on Dubai — see EMPLOYEE_ENTITY_OVERRIDE (Imran Sheikh's TA-DA/Recovery).
    if ((entity.slug !== 'global' && entity.slug !== 'dubai') || !globalEmployees) return;
    const cached = globalCache.recoveryByMonth.get(selectedMonth);
    if (cached !== undefined) {
      setGlobalRecovery(cached);
      setGlobalRecoveryError(null);
      return;
    }
    const codes = globalEmployees.map((e) => e.code).filter((c): c is number => c !== null);
    if (codes.length === 0) {
      globalCache.recoveryByMonth.set(selectedMonth, []);
      setGlobalRecovery([]);
      setGlobalRecoveryError(null);
      return;
    }
    let cancelled = false;
    setGlobalRecoveryError(null);
    fetchKoenigRecovery(codes, selectedMonth).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        globalCache.recoveryByMonth.set(selectedMonth, result.records);
        setGlobalRecovery(result.records);
      } else {
        setGlobalRecovery(null);
        setGlobalRecoveryError(result.error);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [entity.slug, globalEmployees, selectedMonth, globalRefreshTrigger]);

  // Employee Leave Details, same month-scoped-per-code shape as Recovery/TDS above. Global was
  // previously excluded from Leave Days (Koenig/Rayontara only), but now wires into the same
  // generic Employee Leave Details API (api_key 357) via the shared fetchKoenigLeave client.
  const [globalLeave, setGlobalLeave] = useState<LeaveRecord[] | null>(
    () => globalCache.leaveByMonth.get(selectedMonth) ?? null,
  );
  const [globalLeaveError, setGlobalLeaveError] = useState<string | null>(null);

  useEffect(() => {
    if (entity.slug !== 'global' || !globalEmployees) return;
    const cached = globalCache.leaveByMonth.get(selectedMonth);
    if (cached !== undefined) {
      setGlobalLeave(cached);
      setGlobalLeaveError(null);
      return;
    }
    const codes = globalEmployees.map((e) => e.code).filter((c): c is number => c !== null);
    if (codes.length === 0) {
      globalCache.leaveByMonth.set(selectedMonth, []);
      setGlobalLeave([]);
      setGlobalLeaveError(null);
      return;
    }
    let cancelled = false;
    setGlobalLeaveError(null);
    fetchKoenigLeave(codes, selectedMonth).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        globalCache.leaveByMonth.set(selectedMonth, result.records);
        setGlobalLeave(result.records);
      } else {
        setGlobalLeave(null);
        setGlobalLeaveError(result.error);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [entity.slug, globalEmployees, selectedMonth, globalRefreshTrigger]);

  // WFH Infra Reimbursement — Global-DMCC-only (FR-30 / BR-17), month-scoped like Leave/Recovery/
  // TDS above, but a single company-wide bulk query (no EmpCode list needed in the request) rather
  // than per-code, same shape as Meal Passes.
  const [globalWfh, setGlobalWfh] = useState<WfhReimbursementRecord[] | null>(
    () => globalCache.wfhByMonth.get(selectedMonth) ?? null,
  );
  const [globalWfhError, setGlobalWfhError] = useState<string | null>(null);

  useEffect(() => {
    if (entity.slug !== 'global' || !globalEmployees) return;
    const cached = globalCache.wfhByMonth.get(selectedMonth);
    if (cached !== undefined) {
      setGlobalWfh(cached);
      setGlobalWfhError(null);
      return;
    }
    let cancelled = false;
    setGlobalWfhError(null);
    fetchGlobalWfhReimbursements(selectedMonth).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        globalCache.wfhByMonth.set(selectedMonth, result.records);
        setGlobalWfh(result.records);
      } else {
        setGlobalWfh(null);
        setGlobalWfhError(result.error);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [entity.slug, globalEmployees, selectedMonth, globalRefreshTrigger]);

  // GetLastTwoAppraisals (Appraisal Arrear) — not month-scoped, same shape as koenigArrear above.
  // Previously Koenig/Rayontara-only per explicit request; now also wired for Global.
  const [globalArrear, setGlobalArrear] = useState<ArrearRecord[] | null>(() => globalCache.arrear);
  const [globalArrearLoading, setGlobalArrearLoading] = useState(false);
  const [globalArrearError, setGlobalArrearError] = useState<string | null>(null);

  useEffect(() => {
    // Also needed on Dubai — see EMPLOYEE_ENTITY_OVERRIDE (Imran Sheikh's Appraisal Arrear).
    if ((entity.slug !== 'global' && entity.slug !== 'dubai') || !globalEmployees) return;
    if (globalCache.arrear !== null) {
      setGlobalArrear(globalCache.arrear);
      setGlobalArrearError(null);
      setGlobalArrearLoading(false);
      return;
    }
    const codes = globalEmployees.map((e) => e.code).filter((c): c is number => c !== null);
    if (codes.length === 0) {
      globalCache.arrear = [];
      setGlobalArrear([]);
      setGlobalArrearError(null);
      setGlobalArrearLoading(false);
      return;
    }
    let cancelled = false;
    setGlobalArrearLoading(true);
    setGlobalArrearError(null);
    fetchKoenigArrear(codes).then((result) => {
      if (cancelled) return;
      setGlobalArrearLoading(false);
      if (result.ok) {
        globalCache.arrear = result.records;
        setGlobalArrear(result.records);
      } else {
        setGlobalArrear(null);
        setGlobalArrearError(result.error);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [entity.slug, globalEmployees, globalRefreshTrigger]);

  // Overseas employees (Is_oversease=true) power 8 separate country-specific entity tabs (Dubai,
  // USA, UK, New Zealand, Australia, Malaysia, Saudi, Canada) from ONE shared fetch — each tab
  // filters this same list down to its own entity via classifyOverseasEmployee (see
  // utils/overseasEntityMapping.ts for the FZLLC-tag / Payroll Processing Location routing rules).
  // Only employee-master fields are live here (no Appraisal/Loan/Meal/Recovery/TDS/Leave/WFH
  // integration for these entities), same reasoning as Koenig's own PMS-only fields.
  const isOverseasEntity = OVERSEAS_ENTITY_SLUGS.includes(entity.slug as OverseasEntitySlug);
  const [overseasRefreshTrigger, setOverseasRefreshTrigger] = useState(0);
  const [overseasEmployees, setOverseasEmployees] = useState<OverseasEmployeeRaw[] | null>(() => overseasCache.employees);
  const [overseasLoading, setOverseasLoading] = useState(false);
  const [overseasError, setOverseasError] = useState<string | null>(null);
  const [overseasCodeStats, setOverseasCodeStats] = useState<{ matched: number; total: number } | null>(
    () => overseasCache.codeStats,
  );

  useEffect(() => {
    if (!isOverseasEntity) return;
    // Always refetches from the backend on every visit — see the Koenig effect above for why the
    // cache-based "skip if already fetched" shortcut was removed.
    let cancelled = false;
    setOverseasLoading(true);
    setOverseasError(null);
    fetchOverseasLiveEmployees(overseasRefreshTrigger > 0).then((result) => {
      if (cancelled) return;
      setOverseasLoading(false);
      if (result.ok) {
        overseasCache.employees = result.employees;
        overseasCache.codeStats = { matched: result.matched, total: result.total };
        setOverseasEmployees(result.employees);
        setOverseasCodeStats({ matched: result.matched, total: result.total });
      } else {
        setOverseasEmployees(null);
        setOverseasCodeStats(null);
        setOverseasError(result.error);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [isOverseasEntity, overseasRefreshTrigger]);

  const overseasEmployeesForEntity = useMemo(() => {
    if (!overseasEmployees) return null;
    return overseasEmployees.filter((e) => classifyOverseasEmployee(e) === entity.slug);
  }, [overseasEmployees, entity.slug]);

  // Pay Scale (Appraisal API) for the overseas population — one shared fetch covering all 20
  // overseas employees' codes backs all 8 country tabs, same as the employee list itself. Unlike
  // Koenig/Rayontara/Global, PF and NPS are deliberately NOT wired through from this record for
  // overseas rows (see overseasLiveRows.ts) — those are India-specific figures the Appraisal API
  // also happens to return, and every overseas entity's own notes already say India-specific
  // statutory deductions don't apply here. Only Pay Scale (and the Salary/ESI it derives, per the
  // generic — not entity-scoped — computation below) is relevant overseas... except ESI, which
  // IS explicitly re-scoped below (see isAppraisalPfEntity) for the same India-specific reason.
  const [overseasAppraisal, setOverseasAppraisal] = useState<AppraisalRecord[] | null>(() => overseasCache.appraisal);
  const [overseasAppraisalLoading, setOverseasAppraisalLoading] = useState(false);
  const [overseasAppraisalError, setOverseasAppraisalError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOverseasEntity || !overseasEmployees) return;
    if (overseasCache.appraisal !== null) {
      setOverseasAppraisal(overseasCache.appraisal);
      setOverseasAppraisalError(null);
      setOverseasAppraisalLoading(false);
      return;
    }
    const codes = overseasEmployees.map((e) => e.code).filter((c): c is number => c !== null);
    if (codes.length === 0) {
      overseasCache.appraisal = [];
      setOverseasAppraisal([]);
      setOverseasAppraisalError(null);
      setOverseasAppraisalLoading(false);
      return;
    }
    let cancelled = false;
    setOverseasAppraisalLoading(true);
    setOverseasAppraisalError(null);
    fetchKoenigAppraisal(codes).then((result) => {
      if (cancelled) return;
      setOverseasAppraisalLoading(false);
      if (result.ok) {
        overseasCache.appraisal = result.records;
        setOverseasAppraisal(result.records);
      } else {
        setOverseasAppraisal(null);
        setOverseasAppraisalError(result.error);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [isOverseasEntity, overseasEmployees, overseasRefreshTrigger]);

  // Loan Advance — one shared fetch across all 20 overseas employees, same as Appraisal above, but
  // only ever DISPLAYED for USA/UK/New Zealand/Australia/Malaysia/Saudi/Canada, not Dubai, per
  // explicit request (see OVERSEAS_LOAN_ARREAR_SLUGS below).
  const [overseasLoans, setOverseasLoans] = useState<LoanAdvanceRecord[] | null>(() => overseasCache.loans);
  const [overseasLoanLoading, setOverseasLoanLoading] = useState(false);
  const [overseasLoanError, setOverseasLoanError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOverseasEntity || !overseasEmployees) return;
    if (overseasCache.loans !== null) {
      setOverseasLoans(overseasCache.loans);
      setOverseasLoanError(null);
      setOverseasLoanLoading(false);
      return;
    }
    const codes = overseasEmployees.map((e) => e.code).filter((c): c is number => c !== null);
    if (codes.length === 0) {
      overseasCache.loans = [];
      setOverseasLoans([]);
      setOverseasLoanError(null);
      setOverseasLoanLoading(false);
      return;
    }
    let cancelled = false;
    setOverseasLoanLoading(true);
    setOverseasLoanError(null);
    fetchKoenigLoans(codes).then((result) => {
      if (cancelled) return;
      setOverseasLoanLoading(false);
      if (result.ok) {
        overseasCache.loans = result.records;
        setOverseasLoans(result.records);
      } else {
        setOverseasLoans(null);
        setOverseasLoanError(result.error);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [isOverseasEntity, overseasEmployees, overseasRefreshTrigger]);

  // GetLastTwoAppraisals (Appraisal Arrear) — same shared-fetch shape as Loan above.
  const [overseasArrear, setOverseasArrear] = useState<ArrearRecord[] | null>(() => overseasCache.arrear);
  const [overseasArrearLoading, setOverseasArrearLoading] = useState(false);
  const [overseasArrearError, setOverseasArrearError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOverseasEntity || !overseasEmployees) return;
    if (overseasCache.arrear !== null) {
      setOverseasArrear(overseasCache.arrear);
      setOverseasArrearError(null);
      setOverseasArrearLoading(false);
      return;
    }
    const codes = overseasEmployees.map((e) => e.code).filter((c): c is number => c !== null);
    if (codes.length === 0) {
      overseasCache.arrear = [];
      setOverseasArrear([]);
      setOverseasArrearError(null);
      setOverseasArrearLoading(false);
      return;
    }
    let cancelled = false;
    setOverseasArrearLoading(true);
    setOverseasArrearError(null);
    fetchKoenigArrear(codes).then((result) => {
      if (cancelled) return;
      setOverseasArrearLoading(false);
      if (result.ok) {
        overseasCache.arrear = result.records;
        setOverseasArrear(result.records);
      } else {
        setOverseasArrear(null);
        setOverseasArrearError(result.error);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [isOverseasEntity, overseasEmployees, overseasRefreshTrigger]);

  // Recovery Panel (VPF/TA-DA/Recovery) — month-scoped, same shape as globalRecovery above.
  // Currently only displayed on Dubai (see isRecoveryScopedEntity below) but fetched for the whole
  // shared overseas population, same pattern as every other overseas sub-fetch.
  const [overseasRecovery, setOverseasRecovery] = useState<RecoveryRecord[] | null>(
    () => overseasCache.recoveryByMonth.get(selectedMonth) ?? null,
  );
  const [overseasRecoveryError, setOverseasRecoveryError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOverseasEntity || !overseasEmployees) return;
    const cached = overseasCache.recoveryByMonth.get(selectedMonth);
    if (cached !== undefined) {
      setOverseasRecovery(cached);
      setOverseasRecoveryError(null);
      return;
    }
    const codes = overseasEmployees.map((e) => e.code).filter((c): c is number => c !== null);
    if (codes.length === 0) {
      overseasCache.recoveryByMonth.set(selectedMonth, []);
      setOverseasRecovery([]);
      setOverseasRecoveryError(null);
      return;
    }
    let cancelled = false;
    setOverseasRecoveryError(null);
    fetchKoenigRecovery(codes, selectedMonth).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        overseasCache.recoveryByMonth.set(selectedMonth, result.records);
        setOverseasRecovery(result.records);
      } else {
        setOverseasRecovery(null);
        setOverseasRecoveryError(result.error);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [isOverseasEntity, overseasEmployees, selectedMonth, overseasRefreshTrigger]);

  const appraisalByCode = useMemo(() => {
    const map = new Map<number, AppraisalRecord>();
    (liveAppraisal || []).forEach((r) => map.set(r.code, r));
    (koenigAppraisal || []).forEach((r) => map.set(r.code, r));
    (globalAppraisal || []).forEach((r) => map.set(r.code, r));
    (overseasAppraisal || []).forEach((r) => map.set(r.code, r));
    return map;
  }, [liveAppraisal, koenigAppraisal, globalAppraisal, overseasAppraisal]);

  const loansByCode = useMemo(() => {
    const map = new Map<number, LoanAdvanceRecord[]>();
    [...(liveLoans || []), ...(koenigLoans || []), ...(globalLoans || []), ...(overseasLoans || [])].forEach((r) => {
      const existing = map.get(r.code) || [];
      existing.push(r);
      map.set(r.code, existing);
    });
    return map;
  }, [liveLoans, koenigLoans, globalLoans, overseasLoans]);

  // Appraisal Arrear is scoped to Koenig, Rayontara and the 7 non-Dubai overseas entities per
  // explicit request — no Global source, and Dubai deliberately excluded (see
  // OVERSEAS_LOAN_ARREAR_SLUGS below).
  const arrearByCode = useMemo(() => {
    const map = new Map<number, ArrearRecord>();
    [...(liveArrear || []), ...(koenigArrear || []), ...(globalArrear || []), ...(overseasArrear || [])].forEach((r) => map.set(r.code, r));
    return map;
  }, [liveArrear, koenigArrear, globalArrear, overseasArrear]);

  const mealsByCode = useMemo(() => {
    const map = new Map<number, number>();
    [...(liveMeals || []), ...(koenigMeals || []), ...(globalMeals || [])].forEach((r) => map.set(r.code, r.mealAllowance));
    return map;
  }, [liveMeals, koenigMeals, globalMeals]);

  const recoveryByCode = useMemo(() => {
    const map = new Map<number, RecoveryRecord>();
    [...(liveRecovery || []), ...(koenigRecovery || []), ...(globalRecovery || []), ...(overseasRecovery || [])].forEach((r) => map.set(r.code, r));
    return map;
  }, [liveRecovery, koenigRecovery, globalRecovery, overseasRecovery]);

  const tdsByCode = useMemo(() => {
    const map = new Map<number, number>();
    [...(liveTds || []), ...(koenigTds || []), ...(globalTds || [])].forEach((r) => map.set(r.code, r.tds));
    return map;
  }, [liveTds, koenigTds, globalTds]);

  const leaveByCode = useMemo(() => {
    const map = new Map<number, number>();
    [...(liveLeave || []), ...(koenigLeave || []), ...(globalLeave || [])].forEach((r) => map.set(r.code, r.leaveDays));
    return map;
  }, [liveLeave, koenigLeave, globalLeave]);

  // WFH Infra Reimbursement is Global-DMCC-only — no Koenig/Rayontara source. `remarks` carries the
  // API's own Accessories text (e.g. "Internet and landline", "Chat GPT" — what was actually
  // claimed), shown in the Payroll Register's Remarks column alongside the amount.
  const wfhByCode = useMemo(() => {
    const map = new Map<number, { amount: number; remarks: string }>();
    (globalWfh || []).forEach((r) => map.set(r.code, { amount: r.wfhAmount, remarks: r.remarks }));
    return map;
  }, [globalWfh]);

  const rawRows = useMemo(() => {
    if (entity.slug === 'rayontara') {
      return liveEmployees ? buildRayontaraLiveRows(liveEmployees, appraisalByCode) : staticRows;
    }
    if (entity.slug === 'koenig') {
      return koenigEmployees ? buildKoenigLiveRows(koenigEmployees, appraisalByCode, entity.currency) : staticRows;
    }
    if (entity.slug === 'global') {
      if (!globalEmployees) return staticRows;
      const rows = buildKoenigLiveRows(globalEmployees, appraisalByCode, entity.currency);
      // Imran Sheikh (3287) is pulled out — see EMPLOYEE_ENTITY_OVERRIDE, shown under Dubai instead.
      return rows.filter((r) => EMPLOYEE_ENTITY_OVERRIDE[r.code] === undefined);
    }
    if (isOverseasEntity) {
      if (!overseasEmployeesForEntity) return staticRows;
      const rows = buildOverseasLiveRows(overseasEmployeesForEntity, entity.currency, appraisalByCode);
      if (entity.slug === 'dubai' && globalEmployees) {
        const overrideRows = buildKoenigLiveRows(globalEmployees, appraisalByCode, entity.currency)
          .filter((r) => EMPLOYEE_ENTITY_OVERRIDE[r.code] === 'dubai');
        return [...rows, ...overrideRows];
      }
      return rows;
    }
    return staticRows;
  }, [entity.slug, entity.currency, staticRows, liveEmployees, appraisalByCode, koenigEmployees, globalEmployees, isOverseasEntity, overseasEmployeesForEntity]);

  const rayontaraIsLive = entity.slug === 'rayontara' && !!liveEmployees;
  const koenigIsLive = entity.slug === 'koenig' && !!koenigEmployees;
  const globalIsLive = entity.slug === 'global' && !!globalEmployees;
  const overseasIsLive = isOverseasEntity && !!overseasEmployeesForEntity;
  const entityIsLiveNow = rayontaraIsLive || koenigIsLive || globalIsLive || overseasIsLive;

  const liveComputedRows = useMemo(() => {
    const scaled = (entity.source === 'live' || rayontaraIsLive || koenigIsLive || globalIsLive || overseasIsLive)
      ? rawRows
      : rawRows.map((r) => applyMonthFactor(r, sampleFactor(selectedMonth)));

    // Attendance columns are computed live from the selected month, the same way for every
    // entity — not stored data, so they're always correct for whichever month is on screen and
    // recompute automatically when the month picker/stepper changes.
    // Total Days = calendar days in the month minus Saturdays and Sundays only.
    // Present Days / Total Days After Leave Taken = Total Days, UNLESS the employee's DOJ falls
    // in or after the displayed month — someone who joined years ago was present the whole
    // period; only a mid-period joiner (or someone who hasn't joined yet) differs. Relative to
    // the displayed month, not fixed to the employee's own joining month — see utils/attendance.ts
    // for why that matters. Both columns show the same figure: there's no separate leave-tracking
    // source to tell "present" apart from "present after leave taken" without one.
    // Leave Days = Total Days − Total Days After Leave Taken (replaces the old Half Days/Late
    // Marks columns, which had no tracked data source and were always 0).
    // Working Days Per Week follows category — Blue Collar works 6 days, White Collar 5 (FR-14 / BR-10).
    // Salary = Pay Scale / Total Days * Total Days After Leave Taken — a per-day rate off the
    // live Pay Scale amount, prorated by attendance in the displayed month. Only overrides rows
    // that actually have a live Pay Scale amount (Rayontara); every other row keeps its existing
    // Salary/Gross figure untouched.
    // Salary breakup is then derived from that same Salary for every row, every entity: Basic
    // 50%, HRA 25%, Club/Special Allowance 25% (sums to 100% of Salary). Other Allowance is a
    // separate column and untouched by this breakup.
    // ESI checks the row's own Pay Scale (not Salary) against the ₹21,000 threshold: below it,
    // ESI = 0.75% of Salary; at or above it, ESI doesn't apply (0). Only rows with a live Pay
    // Scale amount (Rayontara) can actually be checked against that threshold, so every other
    // row keeps its existing ESI figure rather than guessing.
    // Loan Amount = the month-wise installment due from the Loan Advance API (4 equal monthly
    // installments; start month depends on whether the advance date falls before/on-or-after the
    // 16th — see utils/loanDeduction.ts). For Rayontara specifically, "no active installment due"
    // (no advance on file for this employee, an advance whose 4 installments don't cover this
    // month, or the API being unreachable) is a real, expected state — it shows 0, not "—",
    // since 0 deduction is the correct default rather than an unknown. Every other entity keeps
    // its existing Loan Amount untouched.
    // Meal Passes = the Pluxee Meal Card API's meal_allowance for this employee code (a flat
    // monthly figure, not month-dependent). Same "0 rather than —" reasoning for Rayontara: no
    // meal card on file for this employee is a real, known state.
    // Professional Tax is looked up from each row's own Base Location (Bangalore ₹200, Chennai
    // ₹208, everywhere else 0) — applied to every row of every entity, not just Rayontara, since
    // Base Location is available for all of them (see utils/professionalTax.ts).
    // Recovery Panel: VPF/TADA/Recovery for Rayontara come from whichever deduction record
    // matches this employee code AND the currently-selected month (see
    // vite-plugins/rayontaraRecoveryApiPlugin.ts) — 0 when no matching record, same "known zero,
    // not unknown" reasoning as the other Rayontara-specific overrides. Any remarks text on that
    // record is appended to the row's existing remarks (e.g. resignation status) rather than
    // replacing it, verbatim as the API provided it.
    // Renamed from the column's own value: this is purely the calendar-derived denominator used
    // for the per-day Salary rate below — the "Total Working Days" column itself is now a
    // separate, derived figure (see totalWorkingDays further down), not this calendar constant.
    const calendarTotalDays = weekdaysInMonth(selectedMonth);
    return scaled.map((r) => {
      const totalDaysAfterLeaveTaken = presentDaysForMonth(r.dojRaw, selectedMonth);
      const gross = r.payScaleAmount !== undefined && totalDaysAfterLeaveTaken !== undefined && calendarTotalDays > 0
        ? Math.round((payScaleForMonth(arrearByCode.get(r.code), selectedMonth, r.payScaleAmount) / calendarTotalDays) * totalDaysAfterLeaveTaken * 100) / 100
        : r.gross;
      const round2 = (n: number) => Math.round(n * 100) / 100;
      // ESI and PF are India-specific statutory deductions (EPF/ESI/PT do not apply overseas, per
      // every overseas entity's own notes) — scoped to Koenig/Rayontara/Global even though the same
      // live Appraisal API also returns an EPF figure for overseas employees now that Pay Scale is
      // wired up for them (see overseasLiveRows.ts). Only Salary derives from Pay Scale for every
      // entity — ESI and PF stay "—" for overseas.
      const isAppraisalPfEntity = entity.slug === 'koenig' || entity.slug === 'rayontara' || entity.slug === 'global';
      const esi = r.payScaleAmount !== undefined && isAppraisalPfEntity
        ? (r.payScaleAmount < 21000 ? round2(gross * 0.0075) : 0)
        : r.esi;
      // PF proration: the Appraisal Master API returns a flat ₹1800 for most employees regardless
      // of days actually worked — correct once someone's been present the full month, but
      // overstated for a brand-new joiner's partial first month. Only the ₹1800 bucket is
      // touched — ₹0 and any custom fixed amount pass through exactly as the API returned them.
      const pf = isAppraisalPfEntity && r.pf === 1800 && totalDaysAfterLeaveTaken !== undefined && calendarTotalDays > 0
        ? (totalDaysAfterLeaveTaken === calendarTotalDays
            ? r.pf // present the whole month (joined in an earlier month) — no proration
            : Math.round((1800 / calendarTotalDays) * totalDaysAfterLeaveTaken))
        : r.pf;
      // Loan Advance, Meal Card and Recovery Panel are all company-wide bulk sources, so they
      // apply to any row with a real (not sample-data) Emp Code — Rayontara's known codes or
      // Koenig's recovered ones. A Koenig row whose code couldn't be confidently recovered (NaN)
      // can't be looked up at all — that's an unknown identity, not a confirmed "no record", so
      // it shows "—" rather than 0.
      const isRealCodeEntity = entity.slug === 'rayontara' || entity.slug === 'koenig' || entity.slug === 'global';
      const hasRealCode = isRealCodeEntity && !Number.isNaN(r.code);
      // Loan Amount and Appraisal Arrear are scoped to ALL 8 overseas entities (Dubai included, as
      // of this explicit request — previously excluded) — kept as their own flag rather than
      // folded into isRealCodeEntity/hasRealCode above so Meal/TDS stay untouched (still
      // Koenig/Rayontara/Global only; not requested for any overseas entity).
      const isLoanScopedEntity = isRealCodeEntity || isOverseasEntity;
      const hasRealCodeForLoan = isLoanScopedEntity && !Number.isNaN(r.code);
      const employeeLoans = loansByCode.get(r.code);
      const loan = hasRealCodeForLoan
        ? (employeeLoans ? totalLoanDeductionForMonth(employeeLoans, selectedMonth) : 0)
        : isLoanScopedEntity ? NaN : r.loan;
      const mealpass = hasRealCode
        ? (mealsByCode.get(r.code) ?? 0)
        : isRealCodeEntity ? NaN : r.mealpass;
      // Recovery Panel (VPF/TA-DA/Recovery) is ALSO scoped to Dubai specifically per this explicit
      // request — the other 7 overseas entities weren't asked for it and stay unwired (their
      // columns are hidden anyway — see OVERSEAS_NON_DUBAI_HIDDEN_COLS). VPF itself stays hidden
      // on Dubai too (see DUBAI_HIDDEN_COLS) even though it's computed here alongside TA-DA/Recovery
      // — all three come from the same Recovery Panel record, so there's no separate call to skip.
      const isRecoveryScopedEntity = isRealCodeEntity || entity.slug === 'dubai';
      const hasRealCodeForRecovery = isRecoveryScopedEntity && !Number.isNaN(r.code);
      const recoveryRecord = recoveryByCode.get(r.code);
      const vpf = hasRealCodeForRecovery ? (recoveryRecord?.vpf ?? 0) : isRecoveryScopedEntity ? NaN : r.vpf;
      const tada = hasRealCodeForRecovery ? (recoveryRecord?.tada ?? 0) : isRecoveryScopedEntity ? NaN : r.tada;
      const recovery = hasRealCodeForRecovery ? (recoveryRecord?.recovery ?? 0) : isRecoveryScopedEntity ? NaN : r.recovery;
      // WFH Infra Reimbursement is Global-DMCC-only (FR-30 / BR-17), from the WFH_Infra_Reimbursement
      // API (api_key 17), matched by Emp Code (the API's own `RequestedBy` field) and the selected
      // month via each request's Request Date — same "known zero, not unknown" reasoning as
      // Loan/Meal/Recovery/TDS above: no approved reimbursement on file for this employee this month
      // is a real, known 0, not an unknown. Every other entity keeps its existing WFH Reimbursement
      // figure (sample entities have a static value; Koenig/Rayontara have none, so it stays NaN —
      // see koenigLiveRows.ts/rayontaraLiveRows.ts). Its Accessories text (what was actually
      // claimed, e.g. "Internet and landline") is folded into Remarks below, not a separate column.
      const isWfhScopedEntity = entity.slug === 'global';
      const wfhRecord = isWfhScopedEntity && hasRealCode ? wfhByCode.get(r.code) : undefined;
      const remarks = [
        r.remarks,
        hasRealCodeForRecovery ? recoveryRecord?.remarks : undefined,
        wfhRecord?.remarks,
      ].filter(Boolean).join(' | ');
      const tds = hasRealCode ? (tdsByCode.get(r.code) ?? 0) : isRealCodeEntity ? NaN : r.tds;
      // Leave Days is scoped to Koenig, Rayontara and Global — Taken Leaves from the Employee
      // Leave Details API, matched by Emp Code and the selected month. "No leave record for this
      // employee this month" is a real, known zero (same reasoning as Loan/Meal/Recovery/TDS
      // above), not an unknown — except when the Emp Code itself couldn't be matched, which stays
      // "—". Every other entity keeps the existing DOJ-derived Total Days − Total Days After
      // Leave Taken figure, computed below.
      const isLeaveScopedEntity = entity.slug === 'koenig' || entity.slug === 'rayontara' || entity.slug === 'global';
      // Appraisal Arrear is scoped to Koenig, Rayontara, Global, and (as of this explicit request,
      // Dubai now included) all 8 overseas entities — (New Salary − Old Salary) × pending months,
      // shown only in the month the appraisal was actually processed (see
      // utils/arrearCalculation.ts). An employee with no arrear record, or whose Emp Code couldn't
      // be matched, both show 0/— same reasoning as every other arrear-scoped column above.
      const isArrearScopedEntity = entity.slug === 'koenig' || entity.slug === 'rayontara' || entity.slug === 'global' || isOverseasEntity;
      const appraisalArrear = isArrearScopedEntity
        ? (hasRealCodeForLoan ? appraisalArrearForMonth(arrearByCode.get(r.code), selectedMonth) : NaN)
        : r.appraisalArrear;
      const pt = professionalTaxForLocation(r.location);
      const wfh = isWfhScopedEntity
        ? (hasRealCode ? (wfhRecord?.amount ?? 0) : NaN)
        : r.wfh;
      // Net Payable = Salary − (PF + ESI + Loan + TDS + NPS) + (Arrear + Overtime)
      //             − (DA + VPF + TA/DA + Recovery + Professional Tax) + Appraisal Arrear − Meal Passes
      //             + Commission + WFH Reimbursement.
      // Applied to every row of every entity using each row's own (possibly just-recomputed above)
      // column values. A missing deduction/allowance line item contributes 0, like a blank cell
      // in a spreadsheet formula — but Salary itself is the base the whole figure is built on, not
      // a line item, so an unknown Salary (e.g. Koenig/Rayontara rows the PMS API covers but the
      // Appraisal API doesn't) makes the whole Net Payable unknown too, rather than emitting a
      // deduction-only negative number that implies a real payout was computed.
      const net = Number.isNaN(gross) ? NaN : round2(
        toCalcNumber(gross)
          - (toCalcNumber(pf) + toCalcNumber(esi) + toCalcNumber(loan) + toCalcNumber(tds) + toCalcNumber(r.nps))
          + (toCalcNumber(r.arrear) + toCalcNumber(r.overtime))
          - (toCalcNumber(r.da) + toCalcNumber(vpf) + toCalcNumber(tada) + toCalcNumber(recovery) + toCalcNumber(pt))
          + toCalcNumber(appraisalArrear)
          - toCalcNumber(mealpass)
          + toCalcNumber(r.commission)
          + toCalcNumber(wfh)
      );
      // How many of this month's working days fell before the employee's DOJ (or after, if not
      // yet joined) — NaN when totalDaysAfterLeaveTaken itself is unknown, same as every other
      // DOJ-derived figure. Koenig/Rayontara override this with the real Taken Leaves value from
      // the Employee Leave Details API instead (see isLeaveScopedEntity above).
      const leaveDays = isLeaveScopedEntity
        ? (hasRealCode ? (leaveByCode.get(r.code) ?? 0) : NaN)
        : (totalDaysAfterLeaveTaken !== undefined ? calendarTotalDays - totalDaysAfterLeaveTaken : NaN);
      // Total Working Days = Present Days − Leave Days, applied to every entity per explicit
      // request (replaces the previous flat calendar-weekdays figure as the displayed value).
      const totalWorkingDays = totalDaysAfterLeaveTaken !== undefined && !Number.isNaN(leaveDays)
        ? totalDaysAfterLeaveTaken - leaveDays
        : NaN;
      return {
        ...r,
        totalDays: totalWorkingDays,
        presentDays: totalDaysAfterLeaveTaken,
        totalDaysAfterLeaveTaken,
        leaveDays,
        gross,
        mealpass,
        basic: round2(gross * 0.5),
        hra: round2(gross * 0.25),
        clubSpecialAllowance: round2(gross * 0.25),
        esi,
        pf,
        loan,
        pt,
        vpf,
        tada,
        recovery,
        remarks,
        tds,
        net,
        wfh,
        appraisalArrear,
        // Koenig and Rayontara use the PMS API's own working_days field per employee (matched by
        // Emp Code via r.workingDaysPerWeek, set in koenigLiveRows.ts/rayontaraLiveRows.ts) rather
        // than the Blue/White inference below — confirmed live to be more precise (e.g. "Care
        // taker" shows 7 days, not the inferred 6). Every other entity (including Global, which
        // reuses buildKoenigLiveRows and so also carries a real API value) keeps the existing
        // category-based figure unchanged, per explicit scope.
        workingDaysPerWeek: (entity.slug === 'koenig' || entity.slug === 'rayontara') && r.workingDaysPerWeek !== undefined
          ? r.workingDaysPerWeek
          : (r.category === 'Blue' ? 6 : 5),
        // Koenig and Rayontara classify Category from the PMS API's own Is_blue_collared_job flag
        // per employee (matched by Emp Code via r.isBlueCollarJob, set in
        // koenigLiveRows.ts/rayontaraLiveRows.ts), OR'd with the designation-based inference
        // already on r.category. Confirmed live: Is_blue_collared_job is "No" for every single
        // employee company-wide — including Cooks, Drivers, Housekeeping and Care takers — so
        // trusting it alone would misclassify every real Blue Collar employee as White. The OR
        // means the API flag is honored the moment Koenig actually sets it true for someone, while
        // real blue-collar staff are still correctly marked today via their designation. Every
        // other entity (including Global, which reuses buildKoenigLiveRows) keeps the existing
        // designation-inferred category unchanged.
        category: (entity.slug === 'koenig' || entity.slug === 'rayontara') && (r.isBlueCollarJob || r.category === 'Blue')
          ? 'Blue'
          : (entity.slug === 'koenig' || entity.slug === 'rayontara') ? 'White' : r.category,
      };
    }).filter((r) => hasJoinedByMonth(r.dojRaw, selectedMonth));
  }, [entity.slug, entity.source, rawRows, selectedMonth, loansByCode, mealsByCode, recoveryByCode, tdsByCode, leaveByCode, wfhByCode, arrearByCode, rayontaraIsLive, koenigIsLive, globalIsLive, overseasIsLive]);

  // Month-end freeze (live entities only — Koenig/Rayontara/Global; sample entities are already
  // deterministic per month via applyMonthFactor, with no live-API variability to freeze against).
  // snapshotStatus tracks, per entity+month, whether a frozen copy exists yet: 'unchecked' until
  // the GET resolves, then either 'frozen' (snapshotRows holds the permanent data) or 'none'
  // (nothing frozen yet — liveComputedRows shows provisionally until the save effect below freezes
  // it, first-view-wins, server-enforced — see vite-plugins/snapshotPlugin.ts).
  const [snapshotRows, setSnapshotRows] = useState<PayrollRow[] | null>(null);
  const [snapshotStatus, setSnapshotStatus] = useState<'unchecked' | 'none' | 'frozen'>('unchecked');
  // Guards against re-POSTing the same entity+month twice (e.g. a re-render firing before the
  // in-flight save's own response has updated snapshotStatus to 'frozen').
  const snapshotSaveAttempted = useRef<string | null>(null);
  // Set by the "Update Employee List" button (Koenig/Global/Overseas) to force-overwrite an
  // already-frozen snapshot with freshly re-pulled data once it's ready — see the force-overwrite
  // effect below and vite-plugins/snapshotPlugin.ts's file-level comment for why this exists.
  // Cleared the moment that effect actually fires, so one click means one overwrite, not a
  // standing "always force" mode.
  const forceSnapshotOverwrite = useRef(false);

  const monthIsCompleted = isMonthCompleted(selectedMonth);
  const snapshotKey = `${entity.slug}:${selectedMonth}`;

  // Root-cause fix for a real bug (not just stale test data): liveComputedRows.length > 0 the
  // MOMENT the base employee list resolves — well before any of that entity's slower sub-fetches
  // (Appraisal, Loan, Meal, Recovery, TDS, Leave, WFH) have finished. The freeze effect below used
  // to fire on that very first pass, permanently locking in a snapshot missing Pay Scale/Loan/etc.
  // (server-enforced first-write-wins, no way to un-freeze except deleting the file) — every time a
  // new live column was added, the very first person to view a given month would freeze it before
  // that column ever had a chance to load. This checks every sub-fetch relevant to the currently
  // active live entity has actually settled (resolved OR errored — either way, no longer pending)
  // before the freeze is allowed to fire at all.
  const liveDataSettled = entity.slug === 'rayontara'
    ? (!liveLoading
        && (liveRecovery !== null || recoveryError !== null)
        && (liveTds !== null || tdsError !== null)
        && (liveLeave !== null || leaveError !== null))
    : entity.slug === 'koenig'
      ? ((koenigEmployees !== null || koenigError !== null)
        && (koenigAppraisal !== null || koenigAppraisalError !== null)
        && (koenigLoans !== null || koenigLoanError !== null)
        && (koenigMeals !== null || koenigMealError !== null)
        && (koenigRecovery !== null || koenigRecoveryError !== null)
        && (koenigTds !== null || koenigTdsError !== null)
        && (koenigLeave !== null || koenigLeaveError !== null)
        && (koenigArrear !== null || koenigArrearError !== null))
      : entity.slug === 'global'
        ? ((globalEmployees !== null || globalError !== null)
          && (globalAppraisal !== null || globalAppraisalError !== null)
          && (globalLoans !== null || globalLoanError !== null)
          && (globalMeals !== null || globalMealError !== null)
          && (globalRecovery !== null || globalRecoveryError !== null)
          && (globalTds !== null || globalTdsError !== null)
          && (globalLeave !== null || globalLeaveError !== null)
          && (globalWfh !== null || globalWfhError !== null)
          && (globalArrear !== null || globalArrearError !== null))
        : isOverseasEntity
          ? ((overseasEmployees !== null || overseasError !== null)
            && (overseasAppraisal !== null || overseasAppraisalError !== null)
            && (overseasLoans !== null || overseasLoanError !== null)
            && (overseasArrear !== null || overseasArrearError !== null)
            && (overseasRecovery !== null || overseasRecoveryError !== null)
            // Dubai also pulls Global's data for EMPLOYEE_ENTITY_OVERRIDE (Imran Sheikh, 3287) —
            // must settle too, or Dubai could freeze his row before Pay Scale/Loan/Arrear load.
            && (entity.slug !== 'dubai'
              || ((globalEmployees !== null || globalError !== null)
                && (globalAppraisal !== null || globalAppraisalError !== null)
                && (globalLoans !== null || globalLoanError !== null)
                && (globalArrear !== null || globalArrearError !== null)
                && (globalRecovery !== null || globalRecoveryError !== null))))
          : true; // sample entities never take this path — entityIsLiveNow is false for them

  useEffect(() => {
    setSnapshotRows(null);
    setSnapshotStatus('unchecked');
    if (!entityIsLiveNow || !monthIsCompleted) return;
    let cancelled = false;
    fetchSnapshot(entity.slug, selectedMonth).then((result) => {
      if (cancelled) return;
      if (result.ok && result.exists) {
        setSnapshotRows(result.rows);
        setSnapshotStatus('frozen');
      } else {
        setSnapshotStatus('none');
      }
    });
    return () => { cancelled = true; };
  }, [entity.slug, selectedMonth, entityIsLiveNow, monthIsCompleted]);

  useEffect(() => {
    if (!entityIsLiveNow || !monthIsCompleted) return;
    if (snapshotStatus !== 'none') return;
    if (liveComputedRows.length === 0) return;
    // See liveDataSettled's own comment above — without this, the freeze fires on the very first
    // (incomplete) computed pass, before slower sub-fetches like Appraisal have resolved.
    if (!liveDataSettled) return;
    if (snapshotSaveAttempted.current === snapshotKey) return;
    snapshotSaveAttempted.current = snapshotKey;
    saveSnapshot(entity.slug, selectedMonth, liveComputedRows).then((result) => {
      if (result.ok) {
        setSnapshotRows(result.rows);
        setSnapshotStatus('frozen');
      } else {
        // Freeze failed (e.g. server unreachable) — clear the guard so the next render or next
        // view of this month can retry, and leave status as 'none' so live data keeps showing
        // rather than silently losing the Payroll Register.
        snapshotSaveAttempted.current = null;
      }
    });
  }, [entityIsLiveNow, monthIsCompleted, snapshotStatus, snapshotKey, entity.slug, selectedMonth, liveComputedRows, liveDataSettled]);

  // liveDataSettled (above) only means "resolved at least once" — already true from the PREVIOUS
  // load the moment "Update Employee List" is clicked again, before any of the fresh re-fetches
  // have actually landed. The force-overwrite below needs a signal that's specifically false
  // *during* a refresh and true again once it completes, which is exactly what each Loading flag
  // does (unlike the state values themselves, which keep their last value rather than resetting to
  // null while a re-fetch is in flight). Covers every sub-fetch that has its own Loading flag;
  // Meal/Recovery for Koenig/Global don't (see EntityPage.tsx's other fetch effects), so those two
  // specifically could in rare cases still race on a force-overwrite — a real but much smaller gap
  // than the one this fixes.
  const nothingLoadingForForceOverwrite = entity.slug === 'koenig'
    ? !(koenigLoading || koenigAppraisalLoading || koenigLoanLoading || koenigTdsLoading || koenigLeaveLoading || koenigArrearLoading)
    : entity.slug === 'global'
      ? !(globalLoading || globalAppraisalLoading || globalLoanLoading || globalTdsLoading || globalArrearLoading)
      : isOverseasEntity
        ? !(overseasLoading || overseasAppraisalLoading || overseasLoanLoading || overseasArrearLoading)
          && (entity.slug !== 'dubai' || !(globalLoading || globalAppraisalLoading || globalLoanLoading || globalArrearLoading))
        : true;

  // Force-overwrite an already-frozen snapshot once "Update Employee List" was clicked and the
  // freshly re-pulled data has finished loading. Without this, "Update Employee List" was silently
  // a no-op for any month that had already frozen — it genuinely refreshed the server's data, but
  // rowsForMonth below always prefers snapshotRows over liveComputedRows, so nothing the button did
  // was ever visible.
  useEffect(() => {
    if (!forceSnapshotOverwrite.current) return;
    if (!entityIsLiveNow || !monthIsCompleted || snapshotStatus !== 'frozen') return;
    if (liveComputedRows.length === 0 || !nothingLoadingForForceOverwrite) return;
    forceSnapshotOverwrite.current = false;
    saveSnapshot(entity.slug, selectedMonth, liveComputedRows, true).then((result) => {
      if (result.ok) {
        setSnapshotRows(result.rows);
        setSnapshotStatus('frozen');
        snapshotSaveAttempted.current = snapshotKey;
      }
    });
  }, [entityIsLiveNow, monthIsCompleted, snapshotStatus, snapshotKey, entity.slug, selectedMonth, liveComputedRows, nothingLoadingForForceOverwrite]);

  // The single binding every line below actually reads: frozen data wins for a completed month
  // once one exists; live-computed data otherwise (current month always, or a completed month's
  // very first freeze still in flight).
  const rowsForMonth = snapshotRows ?? liveComputedRows;

  const periodNoteText = useMemo(() => {
    if (isBaseMonth) return null;
    if (entity.source === 'live') {
      return `⚑ No uploaded payroll data for ${monthLabel(selectedMonth)} — showing the actual Salary Sheet you provided (${monthLabel(BASE_MONTH)}), the only period on file.`;
    }
    return `ⓘ Showing illustrative sample figures adjusted for ${monthLabel(selectedMonth)}. Only ${monthLabel(BASE_MONTH)} reflects this dashboard's baseline sample data.`;
  }, [isBaseMonth, entity.source, selectedMonth]);

  // Derived from the rows actually being displayed (rowsForMonth), not the static
  // utils/currencies.ts helper — that helper only ever looks at the static sample data in
  // data/entityRows.json, which is empty/irrelevant for live entities. Confirmed live: Global-DMCC
  // pays 31 of its 34 employees in USD, not the single AED its entities.ts config implies (2 AED, 1
  // EUR) — the old static-only lookup always fell back to entity.currency alone, silently hiding
  // that mix on both this page's "Currency" pill/KPI card and the currency filter chips below.
  const payoutCurrencies = useMemo(() => {
    const set = new Set(rowsForMonth.map((r) => r.currency).filter((c): c is string => !!c));
    return set.size > 0 ? Array.from(set).sort() : [entity.currency];
  }, [rowsForMonth, entity.currency]);
  const hasMultipleCurrencies = payoutCurrencies.length > 1;
  const currencyCount = (c: string) => rowsForMonth.filter((r) => r.currency === c).length;

  const filteredRows = rowsForMonth
    .filter((r) => categoryFilter === 'All' || r.category === categoryFilter)
    .filter((r) => currencyFilter === 'All' || r.currency === currencyFilter);

  // Koenig's Emp Code is only partially recovered (see koenigLiveRows.ts) — sort numerically
  // ascending (not the string/lexicographic order that would put "10" before "2") with unmatched
  // codes (NaN, shown as "—") pushed to the end rather than left in whatever order the PMS bulk
  // API happened to return them in.
  if (entity.slug === 'koenig' || entity.slug === 'global') {
    filteredRows.sort((a, b) => {
      if (Number.isNaN(a.code) && Number.isNaN(b.code)) return 0;
      if (Number.isNaN(a.code)) return 1;
      if (Number.isNaN(b.code)) return -1;
      return a.code - b.code;
    });
  }

  // Global-only removal per explicit request — India-specific statutory columns (PF, ESI, TDS,
  // NPS, VPF, Professional Tax) and Meal Passes don't apply to Global-DMCC's payroll, so they're
  // hidden here rather than left showing an always-zero figure. Bank Account No./IFSC Code/Bank
  // Name/UAN removed per a separate explicit request. Every other entity keeps them.
  const GLOBAL_HIDDEN_COLS = new Set<keyof PayrollRow>(['pf', 'esi', 'tds', 'nps', 'vpf', 'pt', 'mealpass', 'bankacc', 'ifsc', 'bankname', 'uan']);

  // USA/UK/New Zealand/Australia/Malaysia/Saudi/Canada-only removal per explicit request — Dubai
  // is NOT included here and keeps every column as before. Covers the same dead ("—") India-
  // specific/unwired columns as Global's hidden set, plus the salary breakup (Basic/HRA/Other
  // Allowance/Club-Special Allowance/Salary — Pay Scale itself stays visible) and bank/UAN details.
  const OVERSEAS_NON_DUBAI_HIDDEN_COLS = new Set<keyof PayrollRow>([
    'basic', 'hra', 'allowance', 'clubSpecialAllowance', 'gross',
    'pf', 'esi', 'tds', 'nps', 'arrear', 'vpf', 'tada', 'recovery', 'pt', 'mealpass',
    'bankacc', 'ifsc', 'bankname', 'uan',
  ]);
  const isOverseasNonDubai = isOverseasEntity && entity.slug !== 'dubai';

  // Dubai-only removal per explicit request — same India-specific/unwired columns as the other
  // overseas entities' hidden set (PF, ESI, TDS, NPS, VPF, Professional Tax, Meal Passes), plus
  // Overtime/DA, plus Bank Account No./IFSC Code/Bank Name/UAN per a separate explicit request.
  // Unlike OVERSEAS_NON_DUBAI_HIDDEN_COLS above, this deliberately leaves the salary breakup
  // (Basic/HRA/Salary), Loan Amount, Appraisal Arrear, TA/DA and Recovery visible on Dubai — only
  // this specific column set was asked for.
  const DUBAI_HIDDEN_COLS = new Set<keyof PayrollRow>(['pf', 'esi', 'tds', 'nps', 'overtime', 'da', 'vpf', 'pt', 'mealpass', 'bankacc', 'ifsc', 'bankname', 'uan']);

  // Overtime/DA only ever apply to Blue Collar staff (FR-14 / BR-10) — hide them once the
  // current view contains White Collar rows only. WFH Reimbursement is Global-DMCC-only (FR-30 / BR-17).
  const visibleColumns = useMemo(() => {
    const hasBlueInView = filteredRows.some((r) => r.category === 'Blue');
    return PAYROLL_COLS.filter((c) => {
      // Koenig-only removal per explicit request — every other entity (Rayontara included)
      // keeps these columns exactly as before.
      if (entity.slug === 'koenig' && (c.key === 'arrear' || c.key === 'overtime' || c.key === 'da')) return false;
      if ((c.key === 'overtime' || c.key === 'da') && !hasBlueInView) return false;
      if (c.key === 'wfh' && entity.slug !== 'global') return false;
      if (entity.slug === 'global' && GLOBAL_HIDDEN_COLS.has(c.key)) return false;
      if (isOverseasNonDubai && OVERSEAS_NON_DUBAI_HIDDEN_COLS.has(c.key)) return false;
      if (entity.slug === 'dubai' && DUBAI_HIDDEN_COLS.has(c.key)) return false;
      return true;
    });
  }, [filteredRows, entity.slug, isOverseasNonDubai]);

  const isRayontara = entity.slug === 'rayontara';
  const isKoenig = entity.slug === 'koenig';
  const isGlobal = entity.slug === 'global';
  const isLiveNow = rayontaraIsLive || koenigIsLive || globalIsLive || overseasIsLive;

  // Koenig/Global/overseas' static headcount/active/resigned (see data/entities.ts) is
  // illustrative sample data — once the live PMS fetch succeeds, the real classified count
  // replaces it so the KPI cards agree with what the register below actually shows. These entities
  // specifically never fall back to that static figure (stale numbers left over from before they
  // went live) even while their first-ever fetch is still in flight — "—" (unknown yet) is more
  // honest than a number known to be wrong. Every other entity's static figures are accurate for
  // their own (illustrative) sample data, so they're unaffected.
  const resignedCount = rowsForMonth.filter((r) => r.salaryHold === 'Yes').length;
  const isLiveEntityKind = isKoenig || isGlobal || isOverseasEntity;
  const kpiHeadcount = isLiveNow ? rowsForMonth.length : isLiveEntityKind ? undefined : entity.headcount;
  const kpiActive = isLiveNow ? rowsForMonth.length - resignedCount : isLiveEntityKind ? undefined : entity.active;
  const kpiResigned = isLiveNow ? resignedCount : isLiveEntityKind ? undefined : entity.resigned;

  const entTableSub = isLiveNow
    ? `Payroll period: ${monthLabel(selectedMonth)} · ${filteredRows.length} of ${rowsForMonth.length} employees shown — live from the PMS API (financial columns show "—" where the API doesn't provide them; scroll horizontally to see all).`
    : entity.source === 'live'
      ? `Payroll period: ${monthLabel(selectedMonth)} · ${filteredRows.length} of ${rowsForMonth.length} employees shown — every column bifurcated exactly as in your uploaded sheet (scroll horizontally to see all).`
      : `Payroll period: ${monthLabel(selectedMonth)} · showing ${filteredRows.length} of ${rowsForMonth.length} sample rows (illustrative) — same column bifurcation as the uploaded Salary Sheet.`;

  const badgeClass = (entity.source === 'live' || isLiveNow) ? 'src-badge live' : 'src-badge sample';
  const badgeText = isLiveNow
    ? 'Live · synced from PMS API'
    : entity.source === 'live' ? 'Live · from uploaded Salary Sheet' : 'Sample data';
  const entSubText = isLiveNow
    ? `${entity.full} · Payroll entity profile built live from the PMS employee-master API.`
    : entity.source === 'live'
      ? `${entity.full} · Payroll entity profile built from your uploaded Salary Sheet.`
      : `${entity.full} · Payroll entity profile (illustrative sample data for visualization).`;
  const liveSyncNote = isRayontara
    ? (liveLoading ? 'ⓘ Fetching live employee, appraisal, loan/advance and meal card details from the PMS API…'
      : liveError ? `⚠ Could not reach the PMS API (${liveError}) — no employee rows to show.`
      : liveEmployees
        ? [
          '✓ Emp Code, name, designation, bank details, DOJ, UAN and location are live from the PMS API.',
          appraisalError
            ? `⚠ Could not reach the Appraisal API (${appraisalError}) — Pay Scale and PF show "—" until it's reachable (NPS shows 0).`
            : 'Pay Scale, PF and NPS are also live from the Appraisal API.',
          loanError
            ? `⚠ Could not reach the Loan Advance API (${loanError}) — Loan Amount shows 0 until it's reachable.`
            : 'Loan Amount reflects the current month\'s installment from the Loan Advance API.',
          mealError
            ? `⚠ Could not reach the Pluxee Meal Card API (${mealError}) — Meal Passes shows 0 until it's reachable.`
            : 'Meal Passes reflects the live Pluxee Meal Card allowance.',
          recoveryError
            ? `⚠ Could not reach the Recovery Panel API (${recoveryError}) — VPF, TA/DA and Recovery show 0 until it's reachable.`
            : 'VPF, TA/DA and Recovery reflect this month\'s deductions from the Recovery Panel API.',
          tdsError
            ? `⚠ Could not reach the Employee TDS Details API (${tdsError}) — TDS shows 0 until it's reachable.`
            : 'TDS reflects this month\'s deducted amount from the Employee TDS Details API.',
          leaveError
            ? `⚠ Could not reach the Employee Leave Details API (${leaveError}) — Leave Days shows 0 until it's reachable.`
            : 'Leave Days reflects this month\'s Taken Leaves from the Employee Leave Details API.',
          arrearError
            ? `⚠ Could not reach the GetLastTwoAppraisals API (${arrearError}) — Appraisal Arrear shows 0 until it's reachable.`
            : 'Appraisal Arrear reflects a salary-change gap (new vs. old salary × pending months) only in the month it was actually processed, from the GetLastTwoAppraisals API.',
        ].join(' ')
        : null)
    : isKoenig
      ? (koenigLoading ? 'ⓘ Fetching live employee details from the PMS API (Emp Code is recovered by scanning the company\'s code registry the first time — this can take up to a minute)…'
        : koenigError ? `⚠ Could not reach the PMS API (${koenigError}) — no employee rows to show.`
        : koenigEmployees
          ? [
            '✓ Name, designation, bank details, DOJ, UAN and location are live from the PMS API, classified using its own Is_rayontara / Is_oversease flags (Koenig = both false).',
            koenigCodeStats
              ? `Emp Code is recovered by matching each employee against the company's PMS code registry by full name, and by name + Date of Joining when the name alone is shared by more than one employee — ${koenigCodeStats.matched} of ${koenigCodeStats.total} employees got a confident, unique match; the rest show "—" because even that couldn't uniquely identify them, so no code can be trusted.`
              : '',
            koenigAppraisalError
              ? `⚠ Could not reach the Appraisal API (${koenigAppraisalError}) — Pay Scale and PF show "—" until it's reachable (NPS shows 0).`
              : koenigAppraisalLoading
                ? 'ⓘ Fetching Pay Scale, PF and NPS from the Appraisal API for matched employees…'
                : 'Pay Scale, PF and NPS are live from the Appraisal API for employees with a matched Emp Code (rows without one still show "—", since that API can only be queried by code).',
            koenigLoanError
              ? `⚠ Could not reach the Loan Advance API (${koenigLoanError}) — Loan Amount shows 0 for matched employees until it's reachable.`
              : koenigLoanLoading
                ? 'ⓘ Fetching Loan Amount from the Loan Advance API for matched employees…'
                : 'Loan Amount reflects the current month\'s installment from the Loan Advance API for employees with a matched Emp Code.',
            koenigMealError
              ? `⚠ Could not reach the Pluxee Meal Card API (${koenigMealError}) — Meal Passes shows 0 for matched employees until it's reachable.`
              : 'Meal Passes reflects the live Pluxee Meal Card allowance for employees with a matched Emp Code.',
            koenigRecoveryError
              ? `⚠ Could not reach the Recovery Panel API (${koenigRecoveryError}) — VPF, TA/DA and Recovery show 0 for matched employees until it's reachable.`
              : 'VPF, TA/DA and Recovery reflect this month\'s deductions from the Recovery Panel API for employees with a matched Emp Code.',
            koenigTdsError
              ? `⚠ Could not reach the Employee TDS Details API (${koenigTdsError}) — TDS shows 0 for matched employees until it's reachable.`
              : koenigTdsLoading
                ? 'ⓘ Fetching TDS from the Employee TDS Details API for matched employees…'
                : 'TDS reflects this month\'s deducted amount from the Employee TDS Details API for employees with a matched Emp Code.',
            koenigLeaveError
              ? `⚠ Could not reach the Employee Leave Details API (${koenigLeaveError}) — Leave Days shows 0 for matched employees until it's reachable.`
              : koenigLeaveLoading
                ? 'ⓘ Fetching Leave Days from the Employee Leave Details API for matched employees…'
                : 'Leave Days reflects this month\'s Taken Leaves from the Employee Leave Details API for employees with a matched Emp Code.',
            koenigArrearError
              ? `⚠ Could not reach the GetLastTwoAppraisals API (${koenigArrearError}) — Appraisal Arrear shows 0 for matched employees until it's reachable.`
              : koenigArrearLoading
                ? 'ⓘ Fetching Appraisal Arrear from the GetLastTwoAppraisals API for matched employees…'
                : 'Appraisal Arrear reflects a salary-change gap (new vs. old salary × pending months) only in the month it was actually processed, for employees with a matched Emp Code.',
          ].filter(Boolean).join(' ')
          : null)
      : isGlobal
        ? (globalLoading ? 'ⓘ Fetching live employee details from the PMS API (Emp Code is recovered by scanning the company\'s code registry the first time — this can take up to a minute)…'
          : globalError ? `⚠ Could not reach the PMS API (${globalError}) — no employee rows to show.`
          : globalEmployees
            ? [
              '✓ Name, designation, bank details, DOJ, UAN and location are live from the PMS API, classified using its own Is_global flag — these employees belong only to Global, never Koenig or Rayontara.',
              globalCodeStats
                ? `Emp Code is recovered by matching each employee against the company's PMS code registry by full name, and by name + Date of Joining when the name alone is shared by more than one employee — ${globalCodeStats.matched} of ${globalCodeStats.total} employees got a confident, unique match; the rest show "—" because even that couldn't uniquely identify them, so no code can be trusted.`
                : '',
              globalAppraisalError
                ? `⚠ Could not reach the Appraisal API (${globalAppraisalError}) — Pay Scale and PF show "—" until it's reachable (NPS shows 0).`
                : globalAppraisalLoading
                  ? 'ⓘ Fetching Pay Scale, PF and NPS from the Appraisal API for matched employees…'
                  : 'Pay Scale, PF and NPS are live from the Appraisal API for employees with a matched Emp Code (rows without one still show "—", since that API can only be queried by code).',
              globalLoanError
                ? `⚠ Could not reach the Loan Advance API (${globalLoanError}) — Loan Amount shows 0 for matched employees until it's reachable.`
                : globalLoanLoading
                  ? 'ⓘ Fetching Loan Amount from the Loan Advance API for matched employees…'
                  : 'Loan Amount reflects the current month\'s installment from the Loan Advance API for employees with a matched Emp Code.',
              globalMealError
                ? `⚠ Could not reach the Pluxee Meal Card API (${globalMealError}) — Meal Passes shows 0 for matched employees until it's reachable.`
                : 'Meal Passes reflects the live Pluxee Meal Card allowance for employees with a matched Emp Code.',
              globalRecoveryError
                ? `⚠ Could not reach the Recovery Panel API (${globalRecoveryError}) — VPF, TA/DA and Recovery show 0 for matched employees until it's reachable.`
                : 'VPF, TA/DA and Recovery reflect this month\'s deductions from the Recovery Panel API for employees with a matched Emp Code.',
              globalTdsError
                ? `⚠ Could not reach the Employee TDS Details API (${globalTdsError}) — TDS shows 0 for matched employees until it's reachable.`
                : globalTdsLoading
                  ? 'ⓘ Fetching TDS from the Employee TDS Details API for matched employees…'
                  : 'TDS reflects this month\'s deducted amount from the Employee TDS Details API for employees with a matched Emp Code.',
              globalLeaveError
                ? `⚠ Could not reach the Employee Leave Details API (${globalLeaveError}) — Leave Days shows 0 for matched employees until it's reachable.`
                : 'Leave Days reflects this month\'s Taken Leaves from the Employee Leave Details API for employees with a matched Emp Code.',
              globalWfhError
                ? `⚠ Could not reach the WFH Infra Reimbursement API (${globalWfhError}) — WFH Reimbursement shows 0 for matched employees until it's reachable.`
                : 'WFH Reimbursement reflects this month\'s approved amount from the WFH Infra Reimbursement API for employees with a matched Emp Code.',
              globalArrearError
                ? `⚠ Could not reach the GetLastTwoAppraisals API (${globalArrearError}) — Appraisal Arrear shows 0 for matched employees until it's reachable.`
                : globalArrearLoading
                  ? 'ⓘ Fetching Appraisal Arrear from the GetLastTwoAppraisals API for matched employees…'
                  : 'Appraisal Arrear reflects a salary-change gap (new vs. old salary × pending months) only in the month it was actually processed, for employees with a matched Emp Code.',
            ].filter(Boolean).join(' ')
            : null)
        : isOverseasEntity
          ? (overseasLoading ? 'ⓘ Fetching live employee details from the PMS API (Emp Code is recovered by scanning the company\'s code registry the first time — this can take up to a minute)…'
            : overseasError ? `⚠ Could not reach the PMS API (${overseasError}) — no employee rows to show.`
            : overseasEmployees
              ? [
                '✓ Name, designation, bank details, DOJ, UAN and location are live from the PMS API, classified using its own Is_oversease flag and routed to this entity by FZLLC tag / Payroll Processing Location (see README).',
                overseasCodeStats
                  ? `Emp Code is recovered by matching each employee against the company's PMS code registry by full name, and by name + Date of Joining when the name alone is shared by more than one employee — ${overseasCodeStats.matched} of ${overseasCodeStats.total} overseas employees (across all 8 country entities) got a confident, unique match; the rest show "—" because even that couldn't uniquely identify them, so no code can be trusted.`
                  : '',
                overseasAppraisalError
                  ? `⚠ Could not reach the Appraisal API (${overseasAppraisalError}) — Pay Scale and Salary show "—" until it's reachable.`
                  : overseasAppraisalLoading
                    ? 'ⓘ Fetching Pay Scale from the Appraisal API for matched employees…'
                    : 'Pay Scale is live from the Appraisal API for employees with a matched Emp Code (rows without one still show "—", since that API can only be queried by code); Salary is derived from it. PF and ESI don\'t apply overseas, so they stay "—" regardless.',
                overseasLoanError
                  ? `⚠ Could not reach the Loan Advance API (${overseasLoanError}) — Loan Amount shows 0 for matched employees until it's reachable.`
                  : overseasLoanLoading
                    ? 'ⓘ Fetching Loan Amount from the Loan Advance API for matched employees…'
                    : 'Loan Amount reflects the current month\'s installment from the Loan Advance API for employees with a matched Emp Code.',
                overseasArrearError
                  ? `⚠ Could not reach the GetLastTwoAppraisals API (${overseasArrearError}) — Appraisal Arrear shows 0 for matched employees until it's reachable.`
                  : overseasArrearLoading
                    ? 'ⓘ Fetching Appraisal Arrear from the GetLastTwoAppraisals API for matched employees…'
                    : 'Appraisal Arrear reflects a salary-change gap (new vs. old salary × pending months) only in the month it was actually processed, for employees with a matched Emp Code.',
                entity.slug === 'dubai'
                  ? (overseasRecoveryError
                      ? `⚠ Could not reach the Recovery Panel API (${overseasRecoveryError}) — TA/DA and Recovery show 0 for matched employees until it's reachable.`
                      : 'TA/DA and Recovery reflect this month\'s deductions from the Recovery Panel API for employees with a matched Emp Code.')
                  : 'No Recovery integration exists for this entity yet, so TA/DA and Recovery show "—".',
                'No Meal/TDS/Leave/WFH integration exists for this entity yet, so those columns show "—".',
              ].filter(Boolean).join(' ')
              : null)
          : null;

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">
            {entity.name}
            <span className={badgeClass}>{badgeText}</span>
          </h1>
          <p className="page-desc">{entSubText}</p>
        </div>
        <div className="pillbar">
          <button className="pill-btn">
            {hasMultipleCurrencies ? 'Currencies' : 'Currency'}: {payoutCurrencies.join(' & ')}
          </button>
          {isKoenig && (
            <button
              className="pill-btn"
              disabled={koenigLoading}
              onClick={() => {
                refreshKoenigEmployeeList();
                forceSnapshotOverwrite.current = true;
                setKoenigRefreshTrigger((n) => n + 1);
              }}
              title="Re-fetch the employee list, Emp Code matches, and all linked API data from scratch"
            >
              {koenigLoading ? 'Updating…' : 'Update Employee List'}
            </button>
          )}
          {isGlobal && (
            <button
              className="pill-btn"
              disabled={globalLoading}
              onClick={() => {
                refreshGlobalEmployeeList();
                forceSnapshotOverwrite.current = true;
                setGlobalRefreshTrigger((n) => n + 1);
              }}
              title="Re-fetch the employee list, Emp Code matches, and all linked API data from scratch"
            >
              {globalLoading ? 'Updating…' : 'Update Employee List'}
            </button>
          )}
          {isOverseasEntity && (
            <button
              className="pill-btn"
              disabled={overseasLoading}
              onClick={() => {
                refreshOverseasEmployeeList();
                forceSnapshotOverwrite.current = true;
                setOverseasRefreshTrigger((n) => n + 1);
                // Dubai also needs a fresh Global re-fetch — see EMPLOYEE_ENTITY_OVERRIDE
                // (Imran Sheikh, 3287), whose master/Appraisal/Loan/Arrear/Recovery data all come
                // from the Global population, not the overseas one.
                if (entity.slug === 'dubai') {
                  refreshGlobalEmployeeList();
                  setGlobalRefreshTrigger((n) => n + 1);
                }
              }}
              title="Re-fetch the shared overseas employee list (all 8 country entities) and Emp Code matches from scratch"
            >
              {overseasLoading ? 'Updating…' : 'Update Employee List'}
            </button>
          )}
          <button className="pill-btn green" onClick={() => downloadXlsx(entity, filteredRows, visibleColumns)}>Export to Excel</button>
        </div>
      </div>
      <hr className="hr-divider" />

      <div className="kpi-grid">
        <div className="kpi-card"><div className="kpi-num">{fmt(kpiHeadcount)}</div><div className="kpi-label">Total Employees</div></div>
        <div className="kpi-card"><div className="kpi-num">{payoutCurrencies.join(' / ')}</div><div className="kpi-label">Payroll Currency</div></div>
        <div className="kpi-card"><div className="kpi-num">{fmt(kpiActive)}</div><div className="kpi-label">Active</div></div>
        <div className="kpi-card"><div className="kpi-num">{fmt(kpiResigned)}</div><div className="kpi-label">Resigned</div></div>
      </div>

      <div className="card" style={{ marginBottom: 24 }}>
        <div className="table-toolbar">
          <div>
            <h3 style={{ margin: 0 }}>Payroll Register</h3>
            <div className="sub" style={{ marginBottom: 0 }}>{entTableSub}</div>
          </div>
          <MonthControl selectedMonth={selectedMonth} onChange={onSelectedMonthChange} />
        </div>
        {liveSyncNote && <div className="period-note show">{liveSyncNote}</div>}
        {periodNoteText && <div className="period-note show">{periodNoteText}</div>}
        <div className="sub" style={{ color: 'var(--warning)', marginBottom: 12 }}>
          ⚠ This register includes bank account, IFSC and UAN details — treat exports as confidential per your organization's data policy.
        </div>
        {!isKoenig && !isRayontara && (
          <CategoryChips
            filter={categoryFilter}
            onChange={onCategoryFilterChange}
            allCount={rowsForMonth.length}
          />
        )}
        {hasMultipleCurrencies && (
          <CurrencyChips
            currencies={payoutCurrencies}
            filter={currencyFilter}
            onChange={onCurrencyFilterChange}
            countFor={currencyCount}
            allCount={rowsForMonth.length}
          />
        )}
        <PayrollTable
          rows={filteredRows}
          columns={visibleColumns}
          enableColumnFilters={isKoenig || isRayontara}
        />
      </div>

      <div className="note-card" dangerouslySetInnerHTML={{ __html: entity.notes }} />
    </>
  );
}
