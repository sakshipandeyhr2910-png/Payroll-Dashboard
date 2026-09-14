export interface RecoveryRecord {
  code: number;
  vpf: number;
  tada: number;
  recovery: number;
  remarks: string;
}

export type RayontaraRecoveryResult =
  | { ok: true; records: RecoveryRecord[] }
  | { ok: false; error: string };

// Calls the local Vite plugin middleware (vite-plugins/rayontaraRecoveryApiPlugin.ts), which
// holds the Recovery Panel API credentials server-side and does the token exchange — the browser
// never sees them. Unlike the other three Rayontara integrations, this one is month-dependent
// (the deductions themselves are scoped to a payroll month), so it needs re-fetching whenever
// the selected month changes, not just once per entity view.
export async function fetchRayontaraRecovery(selectedMonth: string): Promise<RayontaraRecoveryResult> {
  try {
    const res = await fetch(`/api/rayontara/recovery?month=${encodeURIComponent(selectedMonth)}`);
    const data = (await res.json()) as RayontaraRecoveryResult;
    return data;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error reaching Recovery Panel API' };
  }
}
