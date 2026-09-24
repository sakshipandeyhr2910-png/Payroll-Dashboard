import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuth } from '../_lib/auth.js';
import { kv } from '../_lib/kv.js';
import { refreshCachedToken, withCachedToken } from '../_lib/tokenCache.js';
import { fetchAllOverseasEmployees, fetchToken, type PmsCredentials, type PmsEmployeeRaw } from '../_lib/pmsClient.js';
import { withMatchedCode, type SerializedCodeUniverse } from '../_lib/codeUniverseMatch.js';

// Ported from vite-plugins/rayontaraApiPlugin.ts's '/api/overseas/employees' handler — same PMS
// credentials/token cache and bulk endpoint as Koenig/Global, filtered to Is_oversease=true
// instead. See api/koenig/employees.ts for the code-universe deviation notes (this handler reads
// the KV key `codeUniverse:overseas`). The frontend (src/utils/overseasEntityMapping.ts) splits
// this single list across the 8 country-specific entity tabs (Dubai, USA, UK, New Zealand,
// Australia, Malaysia, Saudi, Canada) using golabl_type / payroll_processing_location.

export interface OverseasEmployeeWithCode extends PmsEmployeeRaw {
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
      ? refreshCachedToken('pms', () => fetchToken(creds)).then((token) => fetchAllOverseasEmployees(creds, token))
      : withCachedToken('pms', () => fetchToken(creds), (token) => fetchAllOverseasEmployees(creds, token));

    const [employees, universe] = await Promise.all([employeesPromise, kv.get<SerializedCodeUniverse>('codeUniverse:overseas')]);

    if (!universe) {
      res.status(503).json({
        ok: false,
        error: 'Employee code cache not yet warmed — run the warm-koenig-cache workflow',
      });
      return;
    }

    const withCodes: OverseasEmployeeWithCode[] = employees.map((e) => withMatchedCode(e, universe));
    const matched = withCodes.filter((e) => e.code !== null).length;
    res.status(200).json({ ok: true, employees: withCodes, matched, total: withCodes.length });
  } catch (err) {
    console.error('[overseas-pms-api]', err);
    const message = err instanceof Error ? err.message : 'Unknown error contacting PMS API';
    res.status(502).json({ ok: false, error: message });
  }
}
