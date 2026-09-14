import { withCachedToken } from './tokenCache';

// Ported from vite-plugins/rayontaraTdsApiPlugin.ts (minus the Vite middleware wiring).

export interface TdsCredentials {
  base: string;
  username: string;
  password: string;
  role: string;
  apiKey: string;
}

export interface TdsRecord {
  code: number;
  tds: number;
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

// Confirmed live: a blank {"EmpCode":"","Month":""} query returns an empty array — like
// Appraisal/Loan, this only returns data when queried by a specific EmpCode (which then returns
// that employee's FULL monthly TDS history back to 2019, one row per month). Month filtering is
// done here client-side from each record's own ForMonth.
//
// TDSAmount and PLITdsAmount are both genuinely TDS deductions (confirmed live: some months have
// both non-zero for the same employee) — there's only one TDS column, so they're summed.
interface TdsRaw {
  EmpCode: number | string | null;
  Name: string | null;
  ForMonth: string | null;
  TDSAmount: number | string | null;
  PLITdsAmount: number | string | null;
}

interface CommonResponse {
  statuscode: number;
  message: string;
  content: string | TdsRaw[] | null;
}

function toNumber(v: unknown): number {
  if (v === null || v === undefined) return 0;
  const n = Number(v);
  return Number.isNaN(n) ? 0 : n;
}

// ForMonth is always "YYYY-MM-01T00:00:00" in the live data — the YYYY-MM prefix is
// selectedMonth's own format, so no further parsing is needed.
function monthKeyOf(forMonth: string | null): string | null {
  if (!forMonth || forMonth.length < 7) return null;
  return forMonth.slice(0, 7);
}

async function fetchToken(creds: TdsCredentials): Promise<TokenState> {
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

function parseContent(content: CommonResponse['content']): TdsRaw[] {
  if (Array.isArray(content)) return content;
  if (typeof content === 'string' && content.trim().length > 0) {
    const parsed = JSON.parse(content);
    return Array.isArray(parsed) ? parsed : [];
  }
  return [];
}

async function fetchTdsForCode(
  creds: TdsCredentials,
  token: TokenState,
  code: number,
  selectedMonth: string,
): Promise<TdsRecord | null> {
  const url = `${creds.base}/api/Kites/Operator/common?apikey=${encodeURIComponent(creds.apiKey)}&accessToken=${encodeURIComponent(token.accessToken)}&deviceToken=${encodeURIComponent(token.deviceToken)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ EmpCode: String(code), Month: '' }),
  });
  if (!res.ok) throw new Error(`common HTTP ${res.status}`);
  const data = (await res.json()) as CommonResponse;
  if (data.statuscode !== 200) throw new Error(`common failed (${data.statuscode}): ${data.message || 'unknown error'}`);
  const raws = parseContent(data.content);
  const match = raws.find((r) => monthKeyOf(r.ForMonth) === selectedMonth);
  if (!match) return null;
  return { code, tds: toNumber(match.TDSAmount) + toNumber(match.PLITdsAmount) };
}

// Bounded concurrency, same reasoning as the Appraisal/Loan clients.
async function fetchTdsForCodes(
  creds: TdsCredentials,
  token: TokenState,
  codes: number[],
  selectedMonth: string,
): Promise<TdsRecord[]> {
  const results: TdsRecord[] = [];
  let nextIndex = 0;
  let failures = 0;
  const CONCURRENCY = 25;

  async function worker() {
    while (nextIndex < codes.length) {
      const code = codes[nextIndex++];
      try {
        const record = await fetchTdsForCode(creds, token, code, selectedMonth);
        if (record) results.push(record);
      } catch {
        failures++;
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  // A high failure rate means the cached token likely expired mid-batch rather than a handful of
  // bad codes — bail out so the retry wrapper refreshes the token, instead of silently caching an
  // empty result that then looks like nobody has any TDS this month.
  if (codes.length > 0 && failures > codes.length * 0.2) {
    throw new Error(`TDS batch aborted: ${failures}/${codes.length} lookups failed`);
  }
  return results;
}

export async function fetchTdsForCodesWithRetry(
  creds: TdsCredentials,
  codes: number[],
  selectedMonth: string,
): Promise<TdsRecord[]> {
  return withCachedToken('tds', () => fetchToken(creds), (token) => fetchTdsForCodes(creds, token, codes, selectedMonth));
}
