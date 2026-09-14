import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuth } from '../_lib/auth';
import { kv } from '../_lib/kv';
import { refreshCachedToken, withCachedToken } from '../_lib/tokenCache';
import { fetchAllKoenigEmployees, fetchToken, type PmsCredentials, type PmsEmployeeRaw } from '../_lib/pmsClient';
import { matchEmployeeCode, type SerializedCodeUniverse } from '../_lib/codeUniverseMatch';

// Ported from vite-plugins/rayontaraApiPlugin.ts's '/api/koenig/employees' handler.
//
// The one substantial behavior change from the original: that file's ~10,000-call code-recovery
// scan (scanCodeUniverse) ran inline, cached in-memory "for the life of the server process". That
// cannot run inside a Vercel function on the Hobby plan's 10-second execution limit, so the scan
// now runs out-of-band (scripts/warmCodeUniverse.ts, scheduled by
// .github/workflows/warm-koenig-cache.yml) and writes its result to the KV key
// `codeUniverse:koenig`. This handler only reads that cached result and does the (fast, bounded)
// per-employee matching — see api/_lib/codeUniverseMatch.ts, ported as-is from the original.

export interface KoenigEmployeeWithCode extends PmsEmployeeRaw {
  code: number | null;
}

function credsFromEnv(): PmsCredentials {
  return {
    base: process.env.PMS_API_BASE || '',
    username: process.env.PMS_USERNAME || '',
    password: process.env.PMS_PASSWORD || '',
    role: process.env.PMS_ROLE || '',
    apiKey: process.env.PMS_API_KEY || '',
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await requireAuth(req);
  if (!auth.ok) {
    res.status(auth.status).json(auth.body);
    return;
  }

  const creds = credsFromEnv();
  // NOTE (deviation from the original): the old '?refresh=true' flag threw away the in-memory
  // scan cache to force a full 10k-call rescan on the next request. There's no inline rescan to
  // trigger anymore — the code universe is only ever refreshed by the warm-koenig-cache GitHub
  // Action (see README.md). This still honors the flag by forcing a fresh PMS token exchange
  // (bypassing the cached one) before re-fetching the live bulk employee list, which is the most
  // "refresh"-like thing this handler can still do on its own.
  const forceRefresh = typeof req.query.refresh === 'string' && req.query.refresh === 'true';

  try {
    const employeesPromise = forceRefresh
      ? refreshCachedToken('pms', () => fetchToken(creds)).then((token) => fetchAllKoenigEmployees(creds, token))
      : withCachedToken('pms', () => fetchToken(creds), (token) => fetchAllKoenigEmployees(creds, token));

    const [employees, universe] = await Promise.all([employeesPromise, kv.get<SerializedCodeUniverse>('codeUniverse:koenig')]);

    if (!universe) {
      res.status(503).json({
        ok: false,
        error: 'Employee code cache not yet warmed — run the warm-koenig-cache workflow',
      });
      return;
    }

    const withCodes: KoenigEmployeeWithCode[] = employees.map((e) => ({ ...e, code: matchEmployeeCode(e, universe) }));
    const matched = withCodes.filter((e) => e.code !== null).length;
    res.status(200).json({ ok: true, employees: withCodes, matched, total: withCodes.length });
  } catch (err) {
    console.error('[koenig-pms-api]', err);
    const message = err instanceof Error ? err.message : 'Unknown error contacting PMS API';
    res.status(502).json({ ok: false, error: message });
  }
}
