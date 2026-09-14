export interface AppraisalRecord {
  code: number;
  amount: number | null;
  currency: string | null;
  epf: number | null;
  allowNPS: boolean;
  employeeShare: number | null;
  employerShare: number | null;
}

export type RayontaraAppraisalResult =
  | { ok: true; records: AppraisalRecord[] }
  | { ok: false; error: string };

// Calls the local Vite plugin middleware (vite-plugins/rayontaraAppraisalApiPlugin.ts), which
// holds the Appraisal API credentials server-side and does the token exchange — the browser
// never sees them.
export async function fetchRayontaraAppraisal(): Promise<RayontaraAppraisalResult> {
  try {
    const res = await fetch('/api/rayontara/appraisal');
    const data = (await res.json()) as RayontaraAppraisalResult;
    return data;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error reaching Appraisal API' };
  }
}
