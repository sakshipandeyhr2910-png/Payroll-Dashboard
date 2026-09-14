import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuth } from '../_lib/auth';
import { withCachedToken } from '../_lib/tokenCache';
import { RAYONTARA_EMP_CODES } from '../_lib/rayontaraEmpCodes';
import { fetchEmployeeByCode, fetchToken, toBool, type PmsCredentials, type PmsEmployee } from '../_lib/pmsClient';

// Ported from vite-plugins/rayontaraApiPlugin.ts's '/api/rayontara/employees' handler.

function credsFromEnv(): PmsCredentials {
  return {
    base: process.env.PMS_API_BASE || '',
    username: process.env.PMS_USERNAME || '',
    password: process.env.PMS_PASSWORD || '',
    role: process.env.PMS_ROLE || '',
    apiKey: process.env.PMS_API_KEY || '',
  };
}

async function fetchRayontaraEmployees(creds: PmsCredentials): Promise<PmsEmployee[]> {
  return withCachedToken('pms', () => fetchToken(creds), async (token) => {
    const results = await Promise.all(RAYONTARA_EMP_CODES.map((code) => fetchEmployeeByCode(creds, token, code)));
    // Is_global=true means the employee belongs only to the Global entity — even one of the
    // fixed Rayontara codes must be dropped here rather than shown under Rayontara.
    return results.filter((e): e is PmsEmployee => e !== null && !toBool(e.Is_global));
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await requireAuth(req);
  if (!auth.ok) {
    res.status(auth.status).json(auth.body);
    return;
  }

  try {
    const employees = await fetchRayontaraEmployees(credsFromEnv());
    res.status(200).json({ ok: true, employees });
  } catch (err) {
    console.error('[rayontara-pms-api]', err);
    const message = err instanceof Error ? err.message : 'Unknown error contacting PMS API';
    res.status(502).json({ ok: false, error: message });
  }
}
