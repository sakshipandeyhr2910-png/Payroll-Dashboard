import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuth } from '../auth';
import { withCachedToken } from '../tokenCache';

// Ported from vite-plugins/rayontaraMealApiPlugin.ts's '/api/rayontara/meal-allowances' handler.
// No Koenig variant exists for this API — confirmed against src/utils/rayontaraMealApi.ts
// (only a Rayontara caller) and there is no koenigMealApi.ts in src/utils.

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

// Unlike the other Rayontara integrations, this endpoint's blank {} query returns EmpCode
// directly on every record (confirmed live) — a single company-wide fetch. Every valid record is
// returned unfiltered — the frontend looks up whichever codes it actually has (Rayontara's known
// list, or Koenig's recovered set).
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

function credsFromEnv(): MealCredentials {
  return {
    base: process.env.MEAL_API_BASE || '',
    username: process.env.MEAL_USERNAME || '',
    password: process.env.MEAL_PASSWORD || '',
    role: process.env.MEAL_ROLE || '',
    apiKey: process.env.MEAL_API_KEY || '',
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await requireAuth(req);
  if (!auth.ok) {
    res.status(auth.status).json(auth.body);
    return;
  }

  const creds = credsFromEnv();
  try {
    const records = await withCachedToken('meal', () => fetchToken(creds), (token) => fetchAllMealAllowances(creds, token));
    res.status(200).json({ ok: true, records });
  } catch (err) {
    console.error('[rayontara-meal-api]', err);
    const message = err instanceof Error ? err.message : 'Unknown error contacting Pluxee Meal Card API';
    res.status(502).json({ ok: false, error: message });
  }
}
