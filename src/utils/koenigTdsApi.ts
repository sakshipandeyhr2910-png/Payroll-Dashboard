import type { TdsRecord } from './rayontaraTdsApi';

export type KoenigTdsResult =
  | { ok: true; records: TdsRecord[] }
  | { ok: false; error: string };

// Unlike Rayontara's fixed 15-code list, Koenig's codes are only known once the PMS code-recovery
// scan has run and matched employees by name (see koenigLiveApi.ts) — so they're sent up in the
// request body along with the month, rather than being a static list the server already knows.
export async function fetchKoenigTds(codes: number[], selectedMonth: string): Promise<KoenigTdsResult> {
  try {
    const res = await fetch('/api/koenig/tds', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ codes, month: selectedMonth }),
    });
    const data = (await res.json()) as KoenigTdsResult;
    return data;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error reaching Employee TDS Details API' };
  }
}
