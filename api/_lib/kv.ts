import { createClient, type Client } from '@libsql/client';

// Turso (libSQL — a SQL/SQLite-compatible database, used here purely as a key/value store) backs
// every serverless function's shared state, replacing the originally-planned Vercel KV/Redis (the
// team couldn't subscribe to a Redis add-on). Every consumer imports `kv` from here rather than
// touching the underlying client directly, so the backend can be swapped again in one place without
// touching auth.ts / tokenCache.ts / api/snapshot/[entity]/[month].ts / the employee-code cache
// readers, or scripts/warmCodeUniverse.ts.
//
// None of what's stored here (the revoked-session-token blocklist, cached Kites API access tokens,
// the ~10,000-entry employee-code-universe cache, and the frozen month-end Payroll Register
// snapshots) is relational — it's all just "look this key up, optionally set it only if absent, and
// optionally expire it" — so a single generic key/value table replicates just the two Redis
// operations (`GET`, `SET ... [EX seconds] [NX]`) every consumer already relies on, preserving
// their exact get/set(key, value, {ex, nx}) call shape and behavior.
//
// TURSO_DATABASE_URL / TURSO_AUTH_TOKEN are read from process.env — set them in Vercel's
// Environment Variables (and as GitHub Actions secrets for scripts/warmCodeUniverse.ts) per
// README.md's "Deploying to Vercel" section.

let client: Client | null = null;
let schemaReady: Promise<void> | null = null;

function getClient(): Client {
  if (!client) {
    const url = process.env.TURSO_DATABASE_URL;
    const authToken = process.env.TURSO_AUTH_TOKEN;
    if (!url) throw new Error('TURSO_DATABASE_URL is not set');
    client = createClient({ url, authToken });
  }
  return client;
}

// Created lazily (not at module load) so importing this file never touches the network — matters
// for scripts/warmCodeUniverse.ts and any future script that imports api/_lib/* without needing KV
// at all. Cached as a Promise (not a boolean) so concurrent callers within the same cold start all
// await the same CREATE TABLE instead of racing duplicate ones.
function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = getClient()
      .execute(
        `CREATE TABLE IF NOT EXISTS kv_store (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          expires_at INTEGER
        )`,
      )
      .then(() => undefined);
  }
  return schemaReady;
}

interface SetOptions {
  /** Seconds until the key expires — mirrors Redis `SET key value EX seconds`. */
  ex?: number;
  /** Only set if the key is absent (or expired) — mirrors Redis `SET key value NX`. */
  nx?: boolean;
}

async function get<T>(key: string): Promise<T | null> {
  await ensureSchema();
  const result = await getClient().execute({
    sql: 'SELECT value, expires_at FROM kv_store WHERE key = ?',
    args: [key],
  });
  const row = result.rows[0];
  if (!row) return null;
  const expiresAt = row.expires_at as number | null;
  if (expiresAt !== null && expiresAt < Date.now()) {
    // SQLite has no built-in TTL — an expired row is only actually reaped the next time something
    // looks it up (same "not guaranteed to vanish exactly on schedule" reality Redis's own
    // passive-expiry has), which is fine since every reader already treats "missing" and "expired"
    // identically.
    await getClient().execute({ sql: 'DELETE FROM kv_store WHERE key = ?', args: [key] });
    return null;
  }
  return JSON.parse(row.value as string) as T;
}

async function set(key: string, value: unknown, opts?: SetOptions): Promise<boolean> {
  await ensureSchema();
  const expiresAt = opts?.ex ? Date.now() + opts.ex * 1000 : null;
  const json = JSON.stringify(value);

  if (opts?.nx) {
    // Atomic "set only if absent" — api/snapshot/[entity]/[month].ts relies on this to make the
    // month-end freeze race-safe across concurrent invocations (two simultaneous first-POSTs for
    // the same entity+month can never both "win"). A row that's technically still present but
    // already expired must count as absent, so it's evicted first — the eviction and the
    // conflict-checked insert aren't one atomic statement, but only one invocation can ever win the
    // INSERT itself (SQLite's own PRIMARY KEY constraint arbitrates that), which is the actual
    // race this guards against.
    await getClient().execute({
      sql: 'DELETE FROM kv_store WHERE key = ? AND expires_at IS NOT NULL AND expires_at < ?',
      args: [key, Date.now()],
    });
    const result = await getClient().execute({
      sql: 'INSERT INTO kv_store (key, value, expires_at) VALUES (?, ?, ?) ON CONFLICT(key) DO NOTHING',
      args: [key, json, expiresAt],
    });
    return result.rowsAffected === 1;
  }

  await getClient().execute({
    sql: `INSERT INTO kv_store (key, value, expires_at) VALUES (?, ?, ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at`,
    args: [key, json, expiresAt],
  });
  return true;
}

export const kv = { get, set };
