import type { ArrearRecord } from './rayontaraArrearApi';

export type KoenigArrearResult =
  | { ok: true; records: ArrearRecord[] }
  | { ok: false; error: string };

// Unlike Rayontara's fixed 15-code list, Koenig's codes are only known once the PMS code-recovery
// scan has run and matched employees by name (see koenigLiveApi.ts) — so they're sent up in the
// request body, rather than being a static list the server already knows.
export async function fetchKoenigArrear(codes: number[]): Promise<KoenigArrearResult> {
  try {
    const res = await fetch('/api/koenig/arrear', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ codes }),
    });
    const data = (await res.json()) as KoenigArrearResult;
    return data;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error reaching GetLastTwoAppraisals API' };
  }
}
