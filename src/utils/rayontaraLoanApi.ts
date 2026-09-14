export interface LoanAdvanceRecord {
  code: number;
  advanceAmount: number;
  dateGiven: string;
}

export type RayontaraLoanResult =
  | { ok: true; records: LoanAdvanceRecord[] }
  | { ok: false; error: string };

// Calls the local Vite plugin middleware (vite-plugins/rayontaraLoanApiPlugin.ts), which holds
// the Loan Advance API credentials server-side and does the token exchange — the browser never
// sees them.
export async function fetchRayontaraLoans(): Promise<RayontaraLoanResult> {
  try {
    const res = await fetch('/api/rayontara/loans');
    const data = (await res.json()) as RayontaraLoanResult;
    return data;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error reaching Loan Advance API' };
  }
}
