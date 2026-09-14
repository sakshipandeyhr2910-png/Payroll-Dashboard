import type { Plugin, ViteDevServer, PreviewServer } from 'vite';
import { RAYONTARA_EMP_CODES } from './rayontaraEmpCodes';

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
// EmpCode and TakenLeaves both come back as raw JSON numbers (not strings, unlike PendingLeaves).
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

let cachedToken: TokenState | null = null;

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

// Bounded concurrency, same reasoning as the Appraisal/Loan/TDS plugins: avoid opening hundreds
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
  // bad codes — bail out so fetchLeaveWithRetry refreshes the token, instead of silently caching
  // an empty result that then looks like nobody took any leave this month. Same reasoning as
  // scanCodeUniverse in vite-plugins/rayontaraApiPlugin.ts.
  if (codes.length > 0 && failures > codes.length * 0.2) {
    throw new Error(`Leave batch aborted: ${failures}/${codes.length} lookups failed`);
  }
  return results;
}

async function fetchLeaveWithRetry(
  creds: LeaveCredentials,
  codes: number[],
  selectedMonth: string,
): Promise<LeaveRecord[]> {
  if (!cachedToken) cachedToken = await fetchToken(creds);
  try {
    return await fetchLeaveForCodes(creds, cachedToken, codes, selectedMonth);
  } catch {
    cachedToken = await fetchToken(creds);
    return await fetchLeaveForCodes(creds, cachedToken, codes, selectedMonth);
  }
}

function registerMiddleware(server: ViteDevServer | PreviewServer, creds: LeaveCredentials) {
  server.middlewares.use('/api/rayontara/leave', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    const url = new URL(req.url || '', 'http://localhost');
    const selectedMonth = url.searchParams.get('month') || '';
    if (!/^\d{4}-\d{2}$/.test(selectedMonth)) {
      res.statusCode = 400;
      res.end(JSON.stringify({ ok: false, error: 'Missing or invalid ?month=YYYY-MM query parameter' }));
      return;
    }
    fetchLeaveWithRetry(creds, RAYONTARA_EMP_CODES, selectedMonth)
      .then((records) => {
        res.statusCode = 200;
        res.end(JSON.stringify({ ok: true, records }));
      })
      .catch((err: unknown) => {
        // eslint-disable-next-line no-console
        console.error('[rayontara-leave-api]', err);
        res.statusCode = 502;
        const message = err instanceof Error ? err.message : 'Unknown error contacting Employee Leave Details API';
        res.end(JSON.stringify({ ok: false, error: message }));
      });
  });
}

// Koenig's codes are only known client-side (recovered by the PMS code-registry scan — see
// rayontaraApiPlugin.ts), so they're sent up in the request body along with the month.
function registerKoenigMiddleware(server: ViteDevServer | PreviewServer, creds: LeaveCredentials) {
  server.middlewares.use('/api/koenig/leave', (req, res) => {
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
      let selectedMonth: string;
      try {
        const parsed = JSON.parse(body || '{}');
        codes = Array.isArray(parsed.codes)
          ? parsed.codes.map(Number).filter((n: number) => Number.isFinite(n))
          : [];
        selectedMonth = typeof parsed.month === 'string' ? parsed.month : '';
      } catch {
        res.statusCode = 400;
        res.end(JSON.stringify({ ok: false, error: 'Invalid JSON body' }));
        return;
      }
      if (!/^\d{4}-\d{2}$/.test(selectedMonth)) {
        res.statusCode = 400;
        res.end(JSON.stringify({ ok: false, error: 'Missing or invalid "month" (expected YYYY-MM)' }));
        return;
      }
      fetchLeaveWithRetry(creds, codes, selectedMonth)
        .then((records) => {
          res.statusCode = 200;
          res.end(JSON.stringify({ ok: true, records }));
        })
        .catch((err: unknown) => {
          // eslint-disable-next-line no-console
          console.error('[koenig-leave-api]', err);
          res.statusCode = 502;
          const message = err instanceof Error ? err.message : 'Unknown error contacting Employee Leave Details API';
          res.end(JSON.stringify({ ok: false, error: message }));
        });
    });
  });
}

export function rayontaraLeaveApiPlugin(creds: LeaveCredentials): Plugin {
  return {
    name: 'rayontara-leave-api',
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
