import type { PayrollRow } from '../types';
import type { LoanAdvanceRecord } from './rayontaraLoanApi';
import type { RecoveryRecord } from './rayontaraRecoveryApi';
import type { ArrearRecord } from './rayontaraArrearApi';
import { weekdaysInMonth, presentDaysForMonth, hasJoinedByMonth } from './attendance';
import { professionalTaxForLocation } from './professionalTax';
import { totalLoanDeductionForMonth } from './loanDeduction';
import { appraisalArrearForMonth, payScaleForMonth } from './arrearCalculation';
import { toCalcNumber } from './format';
import { OVERSEAS_ENTITY_SLUGS, type OverseasEntitySlug } from './overseasEntityMapping';

// Extracted, unchanged, from EntityPage.tsx's own `liveComputedRows` useMemo — the exact same
// per-entity Net Payable computation the HR Payroll Register uses, pulled out into a plain
// function so it can also run outside a React component: scripts/capturePayrollSnapshots.ts (the
// automatic month-end snapshot job) calls this same code, not a second reimplementation that could
// quietly drift from what HR actually sees on screen. EntityPage.tsx calls this too — see its own
// liveComputedRows useMemo, which now just gathers the inputs and delegates here.
export interface EntityRowInputs {
  rawRows: PayrollRow[];
  entitySlug: string;
  selectedMonth: string;
  // appraisal-derived fields (payScaleAmount/pf/nps/currency) are already baked into rawRows by
  // the buildXLiveRows() step upstream — this function never needs the raw Appraisal records
  // themselves, only what the row builders already applied.
  loansByCode: Map<number, LoanAdvanceRecord[]>;
  mealsByCode: Map<number, number>;
  recoveryByCode: Map<number, RecoveryRecord>;
  tdsByCode: Map<number, number>;
  leaveByCode: Map<number, number>;
  wfhByCode: Map<number, { amount: number; remarks: string }>;
  arrearByCode: Map<number, ArrearRecord>;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function computeEntityRows(inputs: EntityRowInputs): PayrollRow[] {
  const {
    rawRows, entitySlug, selectedMonth,
    loansByCode, mealsByCode, recoveryByCode, tdsByCode, leaveByCode, wfhByCode, arrearByCode,
  } = inputs;

  const isOverseasEntity = OVERSEAS_ENTITY_SLUGS.includes(entitySlug as OverseasEntitySlug);
  const calendarTotalDays = weekdaysInMonth(selectedMonth);

  return rawRows.map((r) => {
    const totalDaysAfterLeaveTaken = presentDaysForMonth(r.dojRaw, selectedMonth);
    const gross = r.payScaleAmount !== undefined && totalDaysAfterLeaveTaken !== undefined && calendarTotalDays > 0
      ? Math.round((payScaleForMonth(arrearByCode.get(r.code), selectedMonth, r.payScaleAmount) / calendarTotalDays) * totalDaysAfterLeaveTaken * 100) / 100
      : r.gross;

    const isAppraisalPfEntity = entitySlug === 'koenig' || entitySlug === 'rayontara' || entitySlug === 'global';
    const esi = r.payScaleAmount !== undefined && isAppraisalPfEntity
      ? (r.payScaleAmount < 21000 ? round2(gross * 0.0075) : 0)
      : r.esi;
    const pf = isAppraisalPfEntity && r.pf === 1800 && totalDaysAfterLeaveTaken !== undefined && calendarTotalDays > 0
      ? (totalDaysAfterLeaveTaken === calendarTotalDays ? r.pf : Math.round((1800 / calendarTotalDays) * totalDaysAfterLeaveTaken))
      : r.pf;

    const isRealCodeEntity = entitySlug === 'rayontara' || entitySlug === 'koenig' || entitySlug === 'global';
    const hasRealCode = isRealCodeEntity && !Number.isNaN(r.code);
    const isLoanScopedEntity = isRealCodeEntity || isOverseasEntity;
    const hasRealCodeForLoan = isLoanScopedEntity && !Number.isNaN(r.code);
    const employeeLoans = loansByCode.get(r.code);
    const loan = hasRealCodeForLoan
      ? (employeeLoans ? totalLoanDeductionForMonth(employeeLoans, selectedMonth) : 0)
      : isLoanScopedEntity ? NaN : r.loan;
    const mealpass = hasRealCode
      ? (mealsByCode.get(r.code) ?? 0)
      : isRealCodeEntity ? NaN : r.mealpass;

    const isRecoveryScopedEntity = isRealCodeEntity || entitySlug === 'dubai';
    const hasRealCodeForRecovery = isRecoveryScopedEntity && !Number.isNaN(r.code);
    const recoveryRecord = recoveryByCode.get(r.code);
    const vpf = hasRealCodeForRecovery ? (recoveryRecord?.vpf ?? 0) : isRecoveryScopedEntity ? NaN : r.vpf;
    const tada = hasRealCodeForRecovery ? (recoveryRecord?.tada ?? 0) : isRecoveryScopedEntity ? NaN : r.tada;
    const recovery = hasRealCodeForRecovery ? (recoveryRecord?.recovery ?? 0) : isRecoveryScopedEntity ? NaN : r.recovery;

    const isWfhScopedEntity = entitySlug === 'global';
    const wfhRecord = isWfhScopedEntity && hasRealCode ? wfhByCode.get(r.code) : undefined;
    const remarks = [
      r.remarks,
      hasRealCodeForRecovery ? recoveryRecord?.remarks : undefined,
      wfhRecord?.remarks,
    ].filter(Boolean).join(' | ');
    const tds = hasRealCode ? (tdsByCode.get(r.code) ?? 0) : isRealCodeEntity ? NaN : r.tds;

    const isLeaveScopedEntity = entitySlug === 'koenig' || entitySlug === 'rayontara' || entitySlug === 'global';
    const isArrearScopedEntity = entitySlug === 'koenig' || entitySlug === 'rayontara' || entitySlug === 'global' || isOverseasEntity;
    const appraisalArrear = isArrearScopedEntity
      ? (hasRealCodeForLoan ? appraisalArrearForMonth(arrearByCode.get(r.code), selectedMonth) : NaN)
      : r.appraisalArrear;
    const pt = professionalTaxForLocation(r.location);
    const wfh = isWfhScopedEntity
      ? (hasRealCode ? (wfhRecord?.amount ?? 0) : NaN)
      : r.wfh;

    const net = Number.isNaN(gross) ? NaN : round2(
      toCalcNumber(gross)
        - (toCalcNumber(pf) + toCalcNumber(esi) + toCalcNumber(loan) + toCalcNumber(tds) + toCalcNumber(r.nps))
        + (toCalcNumber(r.arrear) + toCalcNumber(r.overtime))
        - (toCalcNumber(r.da) + toCalcNumber(vpf) + toCalcNumber(tada) + toCalcNumber(recovery) + toCalcNumber(pt))
        + toCalcNumber(appraisalArrear)
        - toCalcNumber(mealpass)
        + toCalcNumber(r.commission)
        + toCalcNumber(wfh),
    );

    const leaveDays = isLeaveScopedEntity
      ? (hasRealCode ? (leaveByCode.get(r.code) ?? 0) : NaN)
      : (totalDaysAfterLeaveTaken !== undefined ? calendarTotalDays - totalDaysAfterLeaveTaken : NaN);
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
      workingDaysPerWeek: (entitySlug === 'koenig' || entitySlug === 'rayontara') && r.workingDaysPerWeek !== undefined
        ? r.workingDaysPerWeek
        : (r.category === 'Blue' ? 6 : 5),
      category: (entitySlug === 'koenig' || entitySlug === 'rayontara') && (r.isBlueCollarJob || r.category === 'Blue')
        ? 'Blue'
        : (entitySlug === 'koenig' || entitySlug === 'rayontara') ? 'White' : r.category,
    };
  }).filter((r) => hasJoinedByMonth(r.dojRaw, selectedMonth));
}
