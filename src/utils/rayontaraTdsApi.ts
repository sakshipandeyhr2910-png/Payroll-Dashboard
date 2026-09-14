export interface TdsRecord {
  code: number;
  tds: number;
}

export type RayontaraTdsResult =
  | { ok: true; records: TdsRecord[] }
  | { ok: false; error: string };

// Calls the local Vite plugin middleware (vite-plugins/rayontaraTdsApiPlugin.ts), which holds the
// Employee TDS Details API credentials server-side. Month-scoped (like the Recovery Panel API),
// so it needs re-fetching whenever the selected month changes, not just once per entity view.
export async function fetchRayontaraTds(selectedMonth: string): Promise<RayontaraTdsResult> {
  try {
    const res = await fetch(`/api/rayontara/tds?month=${encodeURIComponent(selectedMonth)}`);
    const data = (await res.json()) as RayontaraTdsResult;
    return data;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error reaching Employee TDS Details API' };
  }
}
