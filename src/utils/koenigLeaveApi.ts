import type { LeaveRecord } from './rayontaraLeaveApi';

export type KoenigLeaveResult =
  | { ok: true; records: LeaveRecord[] }
  | { ok: false; error: string };

// Unlike Rayontara's fixed 15-code list, Koenig's codes are only known once the PMS code-recovery
// scan has run and matched employees by name (see koenigLiveApi.ts) — so they're sent up in the
// request body along with the month, rather than being a static list the server already knows.
export async function fetchKoenigLeave(codes: number[], selectedMonth: string): Promise<KoenigLeaveResult> {
  try {
    const res = await fetch('/api/koenig/leave', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ codes, month: selectedMonth }),
    });
    const data = (await res.json()) as KoenigLeaveResult;
    return data;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error reaching Employee Leave Details API' };
  }
}
