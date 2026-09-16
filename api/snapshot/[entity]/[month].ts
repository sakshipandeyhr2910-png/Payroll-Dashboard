import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuth } from '../../_lib/auth';
import { kv } from '../../_lib/kv';
import { readJsonBody } from '../../_lib/readBody';

// Ported from vite-plugins/snapshotPlugin.ts. Storage moves from one JSON file per entity+month
// under <project>/.snapshots/ (a Vercel function's filesystem is read-only outside /tmp, and /tmp
// doesn't survive between invocations anyway) to a KV key `snapshot:<entity>:<month>` holding the
// same rowsJson string.
//
// Immutability ("first write wins", permanently — no update/delete endpoint) is still enforced
// server-side: the old version checked `existsSync` then `writeFileSync`, which was safe only
// because a single Node process handled one request at a time on that file. Concurrent Vercel
// invocations make that check-then-write racy, so this uses Redis-style `SET key value NX` (via
// `{ nx: true }`) instead — an atomic "set only if not already set" the KV store itself
// guarantees, so two simultaneous first-POSTs for the same entity+month can never both "win".
const ENTITY_PATTERN = /^[a-z0-9-]{1,40}$/;
const MONTH_PATTERN = /^\d{4}-\d{2}$/;

function snapshotKey(entity: string, month: string): string {
  return `snapshot:${entity}:${month}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await requireAuth(req);
  if (!auth.ok) {
    res.status(auth.status).json(auth.body);
    return;
  }

  const entity = typeof req.query.entity === 'string' ? req.query.entity : '';
  const month = typeof req.query.month === 'string' ? req.query.month : '';

  if (!entity || !month || !ENTITY_PATTERN.test(entity) || !MONTH_PATTERN.test(month)) {
    res.status(400).json({ ok: false, error: 'Invalid entity or month' });
    return;
  }

  const key = snapshotKey(entity, month);

  if (req.method === 'GET') {
    try {
      const rowsJson = await kv.get<string>(key);
      if (rowsJson === null || rowsJson === undefined) {
        res.status(200).json({ ok: true, exists: false });
        return;
      }
      res.status(200).json({ ok: true, exists: true, rowsJson });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Read failed' });
    }
    return;
  }

  if (req.method === 'POST') {
    const parsed = readJsonBody<{ rowsJson?: string; force?: boolean }>(req);
    if (parsed === null) {
      res.status(400).json({ ok: false, error: 'Invalid request body' });
      return;
    }
    if (typeof parsed.rowsJson !== 'string' || parsed.rowsJson.length === 0) {
      res.status(400).json({ ok: false, error: 'Missing rowsJson' });
      return;
    }

    try {
      // force:true bypasses the NX guard entirely with a plain overwrite — see
      // vite-plugins/snapshotPlugin.ts's file-level comment for why this exists (the
      // "Update Employee List" button needs a real way to make a re-pull actually visible once a
      // month is frozen, or it's a silent no-op from the user's point of view).
      if (parsed.force) {
        await kv.set(key, parsed.rowsJson);
        res.status(200).json({ ok: true, alreadyFrozen: false });
        return;
      }
      // Atomic "only if absent" write — see the file-level comment above for why this replaces
      // the old existsSync-then-writeFileSync check.
      const didSet = await kv.set(key, parsed.rowsJson, { nx: true });
      if (didSet) {
        res.status(200).json({ ok: true, alreadyFrozen: false });
        return;
      }
      // Already frozen — first write wins. Hand back what's actually on file (not an error) so
      // the caller can't tell "already frozen" apart from "just froze it" and doesn't need to.
      const existingRowsJson = await kv.get<string>(key);
      res.status(200).json({ ok: true, alreadyFrozen: true, rowsJson: existingRowsJson });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Write failed' });
    }
    return;
  }

  res.status(405).json({ ok: false, error: 'Method not allowed' });
}
