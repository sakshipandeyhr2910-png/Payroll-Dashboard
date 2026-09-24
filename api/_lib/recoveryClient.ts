import { withCachedToken } from './tokenCache.js';

// Ported from vite-plugins/rayontaraRecoveryApiPlugin.ts (minus the Vite middleware wiring).

export interface RecoveryCredentials {
  base: string;
  username: string;
  password: string;
  role: string;
  apiKey: string;
}

export interface RecoveryRecord {
  code: number;
  vpf: number;
  tada: number;
  recovery: number;
  remarks: string;
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

// Confirmed live: a specific EmpCode + blank Month returns that employee's FULL deduction
// history — one row per individual deduction line (not one row per month), Date is the line's own
// date (any day of the month, not always the 1st), and remarks is free text describing what the
// line is. Month filtering is done here from each line's own Date.
interface RecoveryRaw {
  EmpCode: number | string | null;
  Date: string | null;
  currency: number | string | null;
  amount: number | string | null;
  remarks: string | null;
}

interface CommonResponse {
  statuscode: number;
  message: string;
  content: string | RecoveryRaw[] | null;
}

function toNumber(v: unknown): number {
  if (v === null || v === undefined) return 0;
  const n = Number(v);
  return Number.isNaN(n) ? 0 : n;
}

// Date is a full ISO datetime with a real day-of-month (not always "-01" like other Kites
// endpoints) — only the YYYY-MM prefix matters for matching against selectedMonth.
function monthKeyOf(dateStr: string | null): string | null {
  if (!dateStr || dateStr.length < 7) return null;
  return dateStr.slice(0, 7);
}

// Per explicit instruction: the deduction line's own remarks text is what decides which column it
// belongs in, case-insensitively — VPF and TA/DA are matched by keyword, everything else is
// Recovery, the default bucket. TA/DA appears in real data as "TA DA" (space-separated), so the
// pattern tolerates any/no separator between "ta" and "da".
const TADA_PATTERN = /ta\s*[/-]?\s*da/i;

function routeByRemarks(remarksText: string): 'vpf' | 'tada' | 'recovery' {
  const t = remarksText.toLowerCase();
  if (t.includes('vpf')) return 'vpf';
  if (TADA_PATTERN.test(t)) return 'tada';
  return 'recovery';
}

async function fetchToken(creds: RecoveryCredentials): Promise<TokenState> {
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

function parseContent(content: CommonResponse['content']): RecoveryRaw[] {
  if (Array.isArray(content)) return content;
  if (typeof content === 'string' && content.trim().length > 0) {
    const parsed = JSON.parse(content);
    return Array.isArray(parsed) ? parsed : [];
  }
  return [];
}

// An employee can have more than one deduction line in the same month — per explicit
// instruction, sum amounts within each bucket (VPF / TA-DA / Recovery) rather than keeping just
// the last one, and show every matching line's remarks text, verbatim, not summarized.
async function fetchRecoveryForCode(
  creds: RecoveryCredentials,
  token: TokenState,
  code: number,
  selectedMonth: string,
): Promise<RecoveryRecord | null> {
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
  const monthLines = raws.filter((r) => monthKeyOf(r.Date) === selectedMonth);
  if (monthLines.length === 0) return null;

  let vpf = 0;
  let tada = 0;
  let recovery = 0;
  const remarksParts: string[] = [];
  for (const line of monthLines) {
    const amount = toNumber(line.amount);
    const remarksText = (line.remarks ?? '').trim();
    const bucket = routeByRemarks(remarksText);
    if (bucket === 'vpf') vpf += amount;
    else if (bucket === 'tada') tada += amount;
    else recovery += amount;
    if (remarksText) remarksParts.push(remarksText);
  }
  return {
    code,
    vpf: Math.round(vpf * 100) / 100,
    tada: Math.round(tada * 100) / 100,
    recovery: Math.round(recovery * 100) / 100,
    remarks: remarksParts.join(' | '),
  };
}

// Bounded concurrency, same reasoning as the Appraisal/Loan/TDS/Leave clients.
async function fetchRecoveryForCodes(
  creds: RecoveryCredentials,
  token: TokenState,
  codes: number[],
  selectedMonth: string,
): Promise<RecoveryRecord[]> {
  const results: RecoveryRecord[] = [];
  let nextIndex = 0;
  let failures = 0;
  const CONCURRENCY = 25;

  async function worker() {
    while (nextIndex < codes.length) {
      const code = codes[nextIndex++];
      try {
        const record = await fetchRecoveryForCode(creds, token, code, selectedMonth);
        if (record) results.push(record);
      } catch {
        failures++;
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  // A high failure rate means the cached token likely expired mid-batch rather than a handful of
  // bad codes — bail out so the retry wrapper refreshes the token, instead of silently caching an
  // empty result that then looks like nobody has any recovery deductions this month.
  if (codes.length > 0 && failures > codes.length * 0.2) {
    throw new Error(`Recovery batch aborted: ${failures}/${codes.length} lookups failed`);
  }
  return results;
}

export async function fetchRecoveryForCodesWithRetry(
  creds: RecoveryCredentials,
  codes: number[],
  selectedMonth: string,
): Promise<RecoveryRecord[]> {
  return withCachedToken('recovery', () => fetchToken(creds), (token) => fetchRecoveryForCodes(creds, token, codes, selectedMonth));
}
