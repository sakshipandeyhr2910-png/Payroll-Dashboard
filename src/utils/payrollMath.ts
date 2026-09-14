import type { PayrollRow } from '../types';

export function rowDeductions(r: PayrollRow): number {
  const nps = typeof r.nps === 'number' ? r.nps : 0;
  return (r.pf || 0) + (r.esi || 0) + (r.vpf || 0) + nps + (r.tds || 0) + (r.pt || 0)
    + (r.recovery || 0) + (r.loan || 0) + (r.mealpass || 0) + (r.localtax || 0);
}

export function rowAdditions(r: PayrollRow): number {
  return (r.arrear || 0) + (r.overtime || 0) + (r.da || 0) + (r.commission || 0) + (r.wfh || 0);
}
