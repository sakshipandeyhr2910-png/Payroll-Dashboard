import type { Plugin, ViteDevServer, PreviewServer } from 'vite';
import { RAYONTARA_EMP_CODES } from './rayontaraEmpCodes';

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
// that employee's FULL monthly TDS history back to 2019, one row per month, ForMonth always the
// first of the month e.g. "2026-07-01T00:00:00"). Month filtering is done here client-side from
// each record's own ForMonth, same reasoning as the Recovery Panel integration — the request-level
// Month parameter's accepted format is unconfirmed and other endpoints have thrown SQL errors on
// a populated date parameter, so it's left blank and never sent non-empty.
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

let cachedToken: TokenState | null = null;

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

// Bounded concurrency, same reasoning as the Appraisal/Loan plugins: avoid opening hundreds of
// connections at once, and an isolated failed code shouldn't abort the whole batch.
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
  // bad codes — bail out so fetchTdsWithRetry refreshes the token, instead of silently caching an
  // empty result that then looks like nobody has any TDS this month. Same reasoning as
  // scanCodeUniverse in vite-plugins/rayontaraApiPlugin.ts.
  if (codes.length > 0 && failures > codes.length * 0.2) {
    throw new Error(`TDS batch aborted: ${failures}/${codes.length} lookups failed`);
  }
  return results;
}

async function fetchTdsWithRetry(
  creds: TdsCredentials,
  codes: number[],
  selectedMonth: string,
): Promise<TdsRecord[]> {
  if (!cachedToken) cachedToken = await fetchToken(creds);
  try {
    return await fetchTdsForCodes(creds, cachedToken, codes, selectedMonth);
  } catch {
    cachedToken = await fetchToken(creds);
    return await fetchTdsForCodes(creds, cachedToken, codes, selectedMonth);
  }
}

function registerMiddleware(server: ViteDevServer | PreviewServer, creds: TdsCredentials) {
  server.middlewares.use('/api/rayontara/tds', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    const url = new URL(req.url || '', 'http://localhost');
    const selectedMonth = url.searchParams.get('month') || '';
    if (!/^\d{4}-\d{2}$/.test(selectedMonth)) {
      res.statusCode = 400;
      res.end(JSON.stringify({ ok: false, error: 'Missing or invalid ?month=YYYY-MM query parameter' }));
      return;
    }
    fetchTdsWithRetry(creds, RAYONTARA_EMP_CODES, selectedMonth)
      .then((records) => {
        res.statusCode = 200;
        res.end(JSON.stringify({ ok: true, records }));
      })
      .catch((err: unknown) => {
        // eslint-disable-next-line no-console
        console.error('[rayontara-tds-api]', err);
        res.statusCode = 502;
        const message = err instanceof Error ? err.message : 'Unknown error contacting Employee TDS Details API';
        res.end(JSON.stringify({ ok: false, error: message }));
      });
  });
}

// Koenig's codes are only known client-side (recovered by the PMS code-registry scan — see
// rayontaraApiPlugin.ts), so they're sent up in the request body along with the month.
function registerKoenigMiddleware(server: ViteDevServer | PreviewServer, creds: TdsCredentials) {
  server.middlewares.use('/api/koenig/tds', (req, res) => {
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
      fetchTdsWithRetry(creds, codes, selectedMonth)
        .then((records) => {
          res.statusCode = 200;
          res.end(JSON.stringify({ ok: true, records }));
        })
        .catch((err: unknown) => {
          // eslint-disable-next-line no-console
          console.error('[koenig-tds-api]', err);
          res.statusCode = 502;
          const message = err instanceof Error ? err.message : 'Unknown error contacting Employee TDS Details API';
          res.end(JSON.stringify({ ok: false, error: message }));
        });
    });
  });
}

export function rayontaraTdsApiPlugin(creds: TdsCredentials): Plugin {
  return {
    name: 'rayontara-tds-api',
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
