import type { Plugin, ViteDevServer, PreviewServer } from 'vite';

export interface MealCredentials {
  base: string;
  username: string;
  password: string;
  role: string;
  apiKey: string;
}

export interface MealAllowanceRecord {
  code: number;
  mealAllowance: number;
}

interface TokenState {
  accessToken: string;
  deviceToken: string;
}

interface GetTokenResponse {
  statuscode: number;
  message: string;
  content: { accessToken: string; deviceToken: string; Username: string; Role: string } | null;
}

interface MealAllowanceRaw {
  EmpCode: number | string | null;
  meal_allowance: string | number | null;
}

interface CommonResponse {
  statuscode: number;
  message: string;
  content: string | MealAllowanceRaw[] | null;
}

let cachedToken: TokenState | null = null;

async function fetchToken(creds: MealCredentials): Promise<TokenState> {
  const res = await fetch(`${creds.base}/api/Kites/Operator/GetToken`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userName: creds.username,
      userPassword: creds.password,
      userRole: creds.role,
    }),
  });
  if (!res.ok) throw new Error(`GetToken HTTP ${res.status}`);
  const data = (await res.json()) as GetTokenResponse;
  if (data.statuscode !== 200 || !data.content?.accessToken || !data.content?.deviceToken) {
    throw new Error(`GetToken failed: ${data.message || 'no token in response'}`);
  }
  return { accessToken: data.content.accessToken, deviceToken: data.content.deviceToken };
}

function parseContent(content: CommonResponse['content']): MealAllowanceRaw[] {
  if (Array.isArray(content)) return content;
  if (typeof content === 'string' && content.trim().length > 0) {
    const parsed = JSON.parse(content);
    return Array.isArray(parsed) ? parsed : [];
  }
  return [];
}

// Unlike the other two Rayontara integrations, this endpoint's blank {} query returns EmpCode
// directly on every record (confirmed live) — a single company-wide fetch. Originally filtered
// down to the known Rayontara codes here, but now that Koenig also has recovered Emp Codes (see
// vite-plugins/rayontaraApiPlugin.ts), every valid record is returned unfiltered — the frontend
// looks up whichever codes it actually has (Rayontara's known 15, or Koenig's recovered set).
async function fetchAllMealAllowances(creds: MealCredentials, token: TokenState): Promise<MealAllowanceRecord[]> {
  const url = `${creds.base}/api/Kites/Operator/common?apikey=${encodeURIComponent(creds.apiKey)}&accessToken=${encodeURIComponent(token.accessToken)}&deviceToken=${encodeURIComponent(token.deviceToken)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  if (!res.ok) throw new Error(`common HTTP ${res.status}`);
  const data = (await res.json()) as CommonResponse;
  if (data.statuscode !== 200) throw new Error(`common failed (${data.statuscode}): ${data.message || 'unknown error'}`);
  const raws = parseContent(data.content);
  const records: MealAllowanceRecord[] = [];
  for (const raw of raws) {
    const code = Number(raw.EmpCode);
    const mealAllowance = Number(raw.meal_allowance);
    if (Number.isNaN(code) || Number.isNaN(mealAllowance)) continue;
    records.push({ code, mealAllowance });
  }
  return records;
}

async function fetchRayontaraMealAllowances(creds: MealCredentials): Promise<MealAllowanceRecord[]> {
  if (!cachedToken) cachedToken = await fetchToken(creds);
  try {
    return await fetchAllMealAllowances(creds, cachedToken);
  } catch {
    cachedToken = await fetchToken(creds);
    return await fetchAllMealAllowances(creds, cachedToken);
  }
}

function registerMiddleware(server: ViteDevServer | PreviewServer, creds: MealCredentials) {
  server.middlewares.use('/api/rayontara/meal-allowances', (_req, res) => {
    res.setHeader('Content-Type', 'application/json');
    fetchRayontaraMealAllowances(creds)
      .then((records) => {
        res.statusCode = 200;
        res.end(JSON.stringify({ ok: true, records }));
      })
      .catch((err: unknown) => {
        // eslint-disable-next-line no-console
        console.error('[rayontara-meal-api]', err);
        res.statusCode = 502;
        const message = err instanceof Error ? err.message : 'Unknown error contacting Pluxee Meal Card API';
        res.end(JSON.stringify({ ok: false, error: message }));
      });
  });
}

export function rayontaraMealApiPlugin(creds: MealCredentials): Plugin {
  return {
    name: 'rayontara-meal-api',
    configureServer(server) {
      registerMiddleware(server, creds);
    },
    configurePreviewServer(server) {
      registerMiddleware(server, creds);
    },
  };
}
