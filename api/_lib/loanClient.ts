import { withCachedToken } from './tokenCache';

// Ported from vite-plugins/rayontaraLoanApiPlugin.ts (minus the Vite middleware wiring).

export interface LoanCredentials {
  base: string;
  username: string;
  password: string;
  role: string;
  apiKey: string;
}

export interface LoanAdvanceRecord {
  code: number;
  advanceAmount: number;
  dateGiven: string;
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

// The API's own schema is richer than what this dashboard's deduction logic uses — only EmpId,
// LoanAmount and LoanDate are used here; Tenure/EMIAmount/Recovery/Balance are intentionally not
// applied (see the original vite-plugins/rayontaraLoanApiPlugin.ts comment for the full reasoning).
interface LoanAdvanceRaw {
  LoanId: number | null;
  EmpId: number | string | null;
  EmpName: string | null;
  LoanDate: string | null;
  LoanAmount: number | string | null;
  Tenure: number | null;
  RateOfInterest: number | null;
  Remarks: string | null;
  EMIAmount: number | null;
  LastDate: string | null;
  Recovery: number | null;
  Balance: number | null;
}

interface CommonResponse {
  statuscode: number;
  message: string;
  content: string | LoanAdvanceRaw[] | null;
}

async function fetchToken(creds: LoanCredentials): Promise<TokenState> {
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

function parseContent(content: CommonResponse['content']): LoanAdvanceRaw[] {
  if (Array.isArray(content)) return content;
  if (typeof content === 'string' && content.trim().length > 0) {
    const parsed = JSON.parse(content);
    return Array.isArray(parsed) ? parsed : [];
  }
  return [];
}

function toRecords(code: number, raws: LoanAdvanceRaw[]): LoanAdvanceRecord[] {
  const records: LoanAdvanceRecord[] = [];
  for (const raw of raws) {
    const amount = Number(raw.LoanAmount);
    if (raw.LoanAmount === null || Number.isNaN(amount) || !raw.LoanDate) continue;
    records.push({ code, advanceAmount: amount, dateGiven: raw.LoanDate });
  }
  return records;
}

async function fetchAdvancesForCode(creds: LoanCredentials, token: TokenState, code: number): Promise<LoanAdvanceRecord[]> {
  const url = `${creds.base}/api/Kites/Operator/common?apikey=${encodeURIComponent(creds.apiKey)}&accessToken=${encodeURIComponent(token.accessToken)}&deviceToken=${encodeURIComponent(token.deviceToken)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ EmpId: String(code), FromDate: '', ToDate: '' }),
  });
  if (!res.ok) throw new Error(`common HTTP ${res.status}`);
  const data = (await res.json()) as CommonResponse;
  if (data.statuscode !== 200) throw new Error(`common failed (${data.statuscode}): ${data.message || 'unknown error'}`);
  return toRecords(code, parseContent(data.content));
}

// Bounded concurrency (not one big Promise.all) — avoid opening hundreds of connections at once,
// and an isolated failed code shouldn't abort the batch.
async function fetchAdvancesForCodes(creds: LoanCredentials, token: TokenState, codes: number[]): Promise<LoanAdvanceRecord[]> {
  const results: LoanAdvanceRecord[] = [];
  let nextIndex = 0;
  let failures = 0;
  const CONCURRENCY = 25;

  async function worker() {
    while (nextIndex < codes.length) {
      const code = codes[nextIndex++];
      try {
        const records = await fetchAdvancesForCode(creds, token, code);
        results.push(...records);
      } catch {
        failures++;
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  // A high failure rate means the cached token likely expired mid-batch rather than a handful of
  // bad codes — bail out so the retry wrapper refreshes the token, instead of silently caching an
  // empty result that then looks like nobody has an active loan.
  if (codes.length > 0 && failures > codes.length * 0.2) {
    throw new Error(`Loan batch aborted: ${failures}/${codes.length} lookups failed`);
  }
  return results;
}

export async function fetchAdvancesForCodesWithRetry(creds: LoanCredentials, codes: number[]): Promise<LoanAdvanceRecord[]> {
  return withCachedToken('loan', () => fetchToken(creds), (token) => fetchAdvancesForCodes(creds, token, codes));
}
