import type { AppraisalRecord } from './rayontaraAppraisalApi';

export type KoenigAppraisalResult =
  | { ok: true; records: AppraisalRecord[] }
  | { ok: false; error: string };

// Unlike Rayontara's fixed 15-code list, Koenig's codes are only known once the PMS code-recovery
// scan has run and matched employees by name (see koenigLiveApi.ts) — so they're sent up in the
// request body rather than being a static list the server already knows.
export async function fetchKoenigAppraisal(codes: number[]): Promise<KoenigAppraisalResult> {
  try {
    const res = await fetch('/api/koenig/appraisal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ codes }),
    });
    const data = (await res.json()) as KoenigAppraisalResult;
    return data;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error reaching Appraisal API' };
  }
}
