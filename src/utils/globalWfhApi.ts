export interface WfhReimbursementRecord {
  code: number;
  wfhAmount: number;
}

export type GlobalWfhResult =
  | { ok: true; records: WfhReimbursementRecord[] }
  | { ok: false; error: string };

// Calls the local Vite plugin middleware (vite-plugins/rayontaraWfhApiPlugin.ts), which holds the
// WFH Infra Reimbursement API credentials server-side. Global-only (FR-30 / BR-17) and
// month-scoped, same shape as Recovery/TDS/Leave — needs re-fetching whenever the selected month
// changes, not just once per entity view.
export async function fetchGlobalWfhReimbursements(selectedMonth: string): Promise<GlobalWfhResult> {
  try {
    const res = await fetch(`/api/global/wfh?month=${encodeURIComponent(selectedMonth)}`);
    const data = (await res.json()) as GlobalWfhResult;
    return data;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error reaching WFH Infra Reimbursement API' };
  }
}
