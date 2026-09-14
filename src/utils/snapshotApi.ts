import type { PayrollRow } from '../types';

// Plain JSON.stringify turns NaN into null — and this codebase deliberately uses NaN as the
// "genuinely unknown" sentinel across many PayrollRow fields (unmatched Emp Code, undetermined
// leave days, etc. — see EntityPage.tsx/attendance.ts). Losing that distinction on a round trip
// through a snapshot file would silently turn "unknown" into "0" everywhere it's read back
// (Number.isNaN(null) is false). Encoding NaN as a string sentinel here — and only here, at the
// snapshot boundary — keeps every other formula in the app working with real NaN as before.
const NAN_SENTINEL = '__NaN__';

function encodeRows(rows: PayrollRow[]): string {
  return JSON.stringify(rows, (_key, value) => (typeof value === 'number' && Number.isNaN(value) ? NAN_SENTINEL : value));
}

function decodeRows(rowsJson: string): PayrollRow[] {
  return JSON.parse(rowsJson, (_key, value) => (value === NAN_SENTINEL ? NaN : value));
}

export type SnapshotFetchResult =
  | { ok: true; exists: true; rows: PayrollRow[] }
  | { ok: true; exists: false }
  | { ok: false; error: string };

// GET-only — never creates one. Used on every view of a completed month to check whether it's
// already frozen; see saveSnapshot for what happens when it isn't yet.
export async function fetchSnapshot(entitySlug: string, month: string): Promise<SnapshotFetchResult> {
  try {
    const res = await fetch(`/api/snapshot/${entitySlug}/${month}`);
    const data = await res.json();
    if (!data.ok) return { ok: false, error: data.error || 'Snapshot lookup failed' };
    if (!data.exists) return { ok: true, exists: false };
    return { ok: true, exists: true, rows: decodeRows(data.rowsJson) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error reaching snapshot store' };
  }
}

export type SnapshotSaveResult =
  | { ok: true; rows: PayrollRow[] } // the rows now on file — same as sent, unless someone else's request won the race first
  | { ok: false; error: string };

// The server enforces first-write-wins (see vite-plugins/snapshotPlugin.ts) — if a snapshot
// already exists, this returns THAT content rather than an error, so the caller never needs to
// special-case "someone else already froze this" vs. "I just froze it".
export async function saveSnapshot(entitySlug: string, month: string, rows: PayrollRow[]): Promise<SnapshotSaveResult> {
  try {
    const res = await fetch(`/api/snapshot/${entitySlug}/${month}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rowsJson: encodeRows(rows) }),
    });
    const data = await res.json();
    if (!data.ok) return { ok: false, error: data.error || 'Snapshot save failed' };
    // A fresh save doesn't echo rowsJson back (no need to — the caller already has `rows`); an
    // already-frozen response does, so the caller can adopt whatever actually got frozen first.
    return { ok: true, rows: data.alreadyFrozen ? decodeRows(data.rowsJson) : rows };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error reaching snapshot store' };
  }
}
