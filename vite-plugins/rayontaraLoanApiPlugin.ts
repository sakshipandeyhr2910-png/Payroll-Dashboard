import type { Plugin, ViteDevServer, PreviewServer } from 'vite';
import { RAYONTARA_EMP_CODES } from './rayontaraEmpCodes';

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

// Confirmed live against real data (previous credentials for this same api_key returned a
// permanent "Invalid object name 'Mst_Loan'" backend error; this "Employee Loan List" role
// works). A blank {"EmpId":"","FromDate":"","ToDate":""} query returns an empty array — like the
// Appraisal API, this one only returns data when queried by a specific EmpId, so it's fetched
// per-code rather than as one bulk call. An employee can have several loan/advance rows on file
// (each a separate historical advance), not just one.
//
// The API's own schema is richer than what this dashboard's deduction logic uses — it also
// returns Tenure, EMIAmount, RateOfInterest, LastDate, Recovery and Balance, i.e. the company's
// own system already computes its own installment schedule per loan (Tenure isn't always 4 in
// the real data). Per the explicit task spec — "Advance Amount ÷ 4" and the 16th-cutoff rule,
// using only Employee Code / Advance Amount / Date Advance Given — only EmpId, LoanAmount and
// LoanDate are used here; Tenure/EMIAmount/Recovery/Balance are intentionally not applied, since
// the requested calculation doesn't reference them.
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

let cachedToken: TokenState | null = null;

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

async function fetchAdvancesForCode(
  creds: LoanCredentials,
  token: TokenState,
  code: number,
): Promise<LoanAdvanceRecord[]> {
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

// Bounded concurrency (not one big Promise.all) — same reasoning as the Appraisal plugin: avoid
// opening hundreds of connections at once, and an isolated failed code shouldn't abort the batch.
async function fetchAdvancesForCodes(
  creds: LoanCredentials,
  token: TokenState,
  codes: number[],
): Promise<LoanAdvanceRecord[]> {
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
  // bad codes — bail out so fetchAdvancesWithRetry refreshes the token, instead of silently
  // caching an empty result that then looks like nobody has an active loan. Same reasoning as
  // scanCodeUniverse in vite-plugins/rayontaraApiPlugin.ts.
  if (codes.length > 0 && failures > codes.length * 0.2) {
    throw new Error(`Loan batch aborted: ${failures}/${codes.length} lookups failed`);
  }
  return results;
}

export async function fetchAdvancesWithRetry(creds: LoanCredentials, codes: number[]): Promise<LoanAdvanceRecord[]> {
  if (!cachedToken) cachedToken = await fetchToken(creds);
  try {
    return await fetchAdvancesForCodes(creds, cachedToken, codes);
  } catch {
    cachedToken = await fetchToken(creds);
    return await fetchAdvancesForCodes(creds, cachedToken, codes);
  }
}

async function fetchRayontaraAdvances(creds: LoanCredentials): Promise<LoanAdvanceRecord[]> {
  return fetchAdvancesWithRetry(creds, RAYONTARA_EMP_CODES);
}

function registerMiddleware(server: ViteDevServer | PreviewServer, creds: LoanCredentials) {
  server.middlewares.use('/api/rayontara/loans', (_req, res) => {
    res.setHeader('Content-Type', 'application/json');
    fetchRayontaraAdvances(creds)
      .then((records) => {
        res.statusCode = 200;
        res.end(JSON.stringify({ ok: true, records }));
      })
      .catch((err: unknown) => {
        // eslint-disable-next-line no-console
        console.error('[rayontara-loan-api]', err);
        res.statusCode = 502;
        const message = err instanceof Error ? err.message : 'Unknown error contacting Loan Advance API';
        res.end(JSON.stringify({ ok: false, error: message }));
      });
  });
}

// Koenig's codes are only known client-side (recovered by the PMS code-registry scan — see
// rayontaraApiPlugin.ts), so they're sent up in the request body rather than being a static list
// the server already knows, same pattern as /api/koenig/appraisal.
function registerKoenigMiddleware(server: ViteDevServer | PreviewServer, creds: LoanCredentials) {
  server.middlewares.use('/api/koenig/loans', (req, res) => {
    if (req.method !== 'POST') {
      res.statusCode = 405;
      res.end(JSON.stringify({ ok: false, error: 'Method not allowed' }));
      return;
    }
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      let codes: number[];
      try {
        const parsed = JSON.parse(body || '{}');
        codes = Array.isArray(parsed.codes)
          ? parsed.codes.map(Number).filter((n: number) => Number.isFinite(n))
          : [];
      } catch {
        res.statusCode = 400;
        res.end(JSON.stringify({ ok: false, error: 'Invalid JSON body' }));
        return;
      }
      fetchAdvancesWithRetry(creds, codes)
        .then((records) => {
          res.statusCode = 200;
          res.end(JSON.stringify({ ok: true, records }));
        })
        .catch((err: unknown) => {
          // eslint-disable-next-line no-console
          console.error('[koenig-loan-api]', err);
          res.statusCode = 502;
          const message = err instanceof Error ? err.message : 'Unknown error contacting Loan Advance API';
          res.end(JSON.stringify({ ok: false, error: message }));
        });
    });
  });
}

export function rayontaraLoanApiPlugin(creds: LoanCredentials): Plugin {
  return {
    name: 'rayontara-loan-api',
    configureServer(server) {
      registerMiddleware(server, creds);
      registerKoenigMiddleware(server, creds);
    },
    configurePreviewServer(server) {
      registerMiddleware(server, creds);
      registerKoenigMiddleware(server, creds);
    },
  };
}
