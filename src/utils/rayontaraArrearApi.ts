export interface ArrearRecord {
  code: number;
  newSalary: number | null;
  oldSalary: number | null;
  appraisalDate: string | null;
  createdDate: string | null;
}

export type RayontaraArrearResult =
  | { ok: true; records: ArrearRecord[] }
  | { ok: false; error: string };

// Calls the local Vite plugin middleware (vite-plugins/rayontaraArrearApiPlugin.ts), which holds
// the GetLastTwoAppraisals API credentials (and the Salary decryption key) server-side. Not
// month-scoped — same architecture as Loan Advance — so this is fetched once per entity view, not
// re-fetched when the selected month changes; utils/arrearCalculation.ts derives the
// month-specific figure from these raw records on demand.
export async function fetchRayontaraArrear(): Promise<RayontaraArrearResult> {
  try {
    const res = await fetch('/api/rayontara/arrear');
    const data = (await res.json()) as RayontaraArrearResult;
    return data;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error reaching GetLastTwoAppraisals API' };
  }
}
