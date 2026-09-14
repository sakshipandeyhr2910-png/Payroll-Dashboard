import { withCachedToken } from './tokenCache';

// Ported from vite-plugins/rayontaraLeaveApiPlugin.ts (minus the Vite middleware wiring).

export interface LeaveCredentials {
  base: string;
  username: string;
  password: string;
  role: string;
  apiKey: string;
}

export interface LeaveRecord {
  code: number;
  leaveDays: number;
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

// Confirmed live: unlike Appraisal/Loan/TDS (blank Month returns everything, filtered
// client-side), this endpoint requires a specific "YYYY-MM-01" Month value in the request itself
// — blank or "YYYY-MM" both return null. With a valid Month + EmpCode it returns exactly one
// record already scoped to that month, so no client-side ForMonth filtering is needed here.
interface LeaveRaw {
  EmpCode: number | string | null;
  EmpName: string | null;
  ForMonth: string | null;
  PendingLeaves: number | string | null;
  TakenLeaves: number | string | null;
}

interface CommonResponse {
  statuscode: number;
  message: string;
  content: string | LeaveRaw[] | null;
}

function toNumber(v: unknown): number {
  if (v === null || v === undefined) return 0;
  const n = Number(v);
  return Number.isNaN(n) ? 0 : n;
}

async function fetchToken(creds: LeaveCredentials): Promise<TokenState> {
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

function parseContent(content: CommonResponse['content']): LeaveRaw[] {
  if (Array.isArray(content)) return content;
  if (typeof content === 'string' && content.trim().length > 0) {
    const parsed = JSON.parse(content);
    return Array.isArray(parsed) ? parsed : [];
  }
  return [];
}

async function fetchLeaveForCode(
  creds: LeaveCredentials,
  token: TokenState,
  code: number,
  selectedMonth: string,
): Promise<LeaveRecord | null> {
  const url = `${creds.base}/api/Kites/Operator/common?apikey=${encodeURIComponent(creds.apiKey)}&accessToken=${encodeURIComponent(token.accessToken)}&deviceToken=${encodeURIComponent(token.deviceToken)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ Month: `${selectedMonth}-01`, EmpCode: String(code) }),
  });
  if (!res.ok) throw new Error(`common HTTP ${res.status}`);
  const data = (await res.json()) as CommonResponse;
  if (data.statuscode !== 200) throw new Error(`common failed (${data.statuscode}): ${data.message || 'unknown error'}`);
  const [raw] = parseContent(data.content);
  if (!raw) return null;
  return { code, leaveDays: toNumber(raw.TakenLeaves) };
}

// Bounded concurrency, same reasoning as the Appraisal/Loan/TDS clients: avoid opening hundreds
// of connections at once, and an isolated failed code shouldn't abort the whole batch.
async function fetchLeaveForCodes(
  creds: LeaveCredentials,
  token: TokenState,
  codes: number[],
  selectedMonth: string,
): Promise<LeaveRecord[]> {
  const results: LeaveRecord[] = [];
  let nextIndex = 0;
  let failures = 0;
  const CONCURRENCY = 25;

  async function worker() {
    while (nextIndex < codes.length) {
      const code = codes[nextIndex++];
      try {
        const record = await fetchLeaveForCode(creds, token, code, selectedMonth);
        if (record) results.push(record);
      } catch {
        failures++;
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  // A high failure rate means the cached token likely expired mid-batch rather than a handful of
  // bad codes — bail out so the retry wrapper refreshes the token, instead of silently caching an
  // empty result that then looks like nobody took any leave this month.
  if (codes.length > 0 && failures > codes.length * 0.2) {
    throw new Error(`Leave batch aborted: ${failures}/${codes.length} lookups failed`);
  }
  return results;
}

export async function fetchLeaveForCodesWithRetry(
  creds: LeaveCredentials,
  codes: number[],
  selectedMonth: string,
): Promise<LeaveRecord[]> {
  return withCachedToken('leave', () => fetchToken(creds), (token) => fetchLeaveForCodes(creds, token, codes, selectedMonth));
}
