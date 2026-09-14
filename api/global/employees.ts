import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuth } from '../_lib/auth';
import { kv } from '../_lib/kv';
import { refreshCachedToken, withCachedToken } from '../_lib/tokenCache';
import { fetchAllGlobalEmployees, fetchToken, type PmsCredentials, type PmsEmployeeRaw } from '../_lib/pmsClient';
import { matchEmployeeCode, type SerializedCodeUniverse } from '../_lib/codeUniverseMatch';

// Ported from vite-plugins/rayontaraApiPlugin.ts's '/api/global/employees' handler — same PMS
// credentials/token cache and bulk endpoint as Koenig/Rayontara, filtered to Is_global=true
// instead. See api/koenig/employees.ts for the code-universe deviation notes (this handler reads
// the KV key `codeUniverse:global` instead of `codeUniverse:koenig`).

export interface GlobalEmployeeWithCode extends PmsEmployeeRaw {
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
  const forceRefresh = typeof req.query.refresh === 'string' && req.query.refresh === 'true';

  try {
    const employeesPromise = forceRefresh
      ? refreshCachedToken('pms', () => fetchToken(creds)).then((token) => fetchAllGlobalEmployees(creds, token))
      : withCachedToken('pms', () => fetchToken(creds), (token) => fetchAllGlobalEmployees(creds, token));

    const [employees, universe] = await Promise.all([employeesPromise, kv.get<SerializedCodeUniverse>('codeUniverse:global')]);

    if (!universe) {
      res.status(503).json({
        ok: false,
        error: 'Employee code cache not yet warmed — run the warm-koenig-cache workflow',
      });
      return;
    }

    const withCodes: GlobalEmployeeWithCode[] = employees.map((e) => ({ ...e, code: matchEmployeeCode(e, universe) }));
    const matched = withCodes.filter((e) => e.code !== null).length;
    res.status(200).json({ ok: true, employees: withCodes, matched, total: withCodes.length });
  } catch (err) {
    console.error('[global-pms-api]', err);
    const message = err instanceof Error ? err.message : 'Unknown error contacting PMS API';
    res.status(502).json({ ok: false, error: message });
  }
}
