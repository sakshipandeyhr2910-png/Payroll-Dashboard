export interface MealAllowanceRecord {
  code: number;
  mealAllowance: number;
}

export type RayontaraMealResult =
  | { ok: true; records: MealAllowanceRecord[] }
  | { ok: false; error: string };

// Calls the local Vite plugin middleware (vite-plugins/rayontaraMealApiPlugin.ts), which holds
// the Pluxee Meal Card API credentials server-side and does the token exchange — the browser
// never sees them.
export async function fetchRayontaraMealAllowances(): Promise<RayontaraMealResult> {
  try {
    const res = await fetch('/api/rayontara/meal-allowances');
    const data = (await res.json()) as RayontaraMealResult;
    return data;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error reaching Pluxee Meal Card API' };
  }
}
