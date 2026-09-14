import type { KoenigEmployeeRaw, KoenigLiveResult } from './koenigLiveApi';

export type { KoenigEmployeeRaw as GlobalEmployeeRaw, KoenigLiveResult as GlobalLiveResult };

// Calls the local Vite plugin middleware (vite-plugins/rayontaraApiPlugin.ts) — same PMS
// credentials/token cache and bulk endpoint as Koenig/Rayontara, filtered to Is_global=true
// instead of Is_rayontara/Is_oversease=false. Same schema and Emp Code recovery as Koenig, so it
// reuses KoenigEmployeeRaw/KoenigLiveResult rather than duplicating an identical type.
// forceRefresh (?refresh=true) — see fetchKoenigLiveEmployees's comment; same shared, otherwise
// permanently-cached code-matching scan on the server side.
export async function fetchGlobalLiveEmployees(forceRefresh = false): Promise<KoenigLiveResult> {
  try {
    const res = await fetch(`/api/global/employees${forceRefresh ? '?refresh=true' : ''}`);
    const data = (await res.json()) as KoenigLiveResult;
    return data;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error reaching PMS API' };
  }
}
