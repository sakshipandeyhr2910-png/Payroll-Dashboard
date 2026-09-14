export interface LeaveRecord {
  code: number;
  leaveDays: number;
}

export type RayontaraLeaveResult =
  | { ok: true; records: LeaveRecord[] }
  | { ok: false; error: string };

// Calls the local Vite plugin middleware (vite-plugins/rayontaraLeaveApiPlugin.ts), which holds
// the Employee Leave Details API credentials server-side. Month-scoped (like Recovery/TDS), so it
// needs re-fetching whenever the selected month changes, not just once per entity view.
export async function fetchRayontaraLeave(selectedMonth: string): Promise<RayontaraLeaveResult> {
  try {
    const res = await fetch(`/api/rayontara/leave?month=${encodeURIComponent(selectedMonth)}`);
    const data = (await res.json()) as RayontaraLeaveResult;
    return data;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error reaching Employee Leave Details API' };
  }
}
