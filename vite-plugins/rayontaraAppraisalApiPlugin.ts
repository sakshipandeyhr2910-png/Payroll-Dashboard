import type { Plugin, ViteDevServer, PreviewServer } from 'vite';
import { RAYONTARA_EMP_CODES } from './rayontaraEmpCodes';
import { decryptKoenigValue, verifyKoenigDecryption } from './koenigDecryption';

export interface AppraisalCredentials {
  base: string;
  username: string;
  password: string;
  role: string;
  apiKey: string;
  decryptPassword: string;
  decryptSalt: string;
}

export interface AppraisalRecord {
  code: number;
  amount: number | null;
  currency: string | null;
  epf: number | null;
  allowNPS: boolean;
  employeeShare: number | null;
  employerShare: number | null;
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

// Raw shape of a single record inside the (double-encoded) "content" string.
interface AppraisalRaw {
  Amount: string | null;
  Currency: string | null;
  EPF: string | null;
  AllowNPS: string | null;
  EmployeeShare: string | null;
  EmployerShare: string | null;
}

interface CommonResponse {
  statuscode: number;
  message: string;
  content: string | AppraisalRaw[] | null;
}

let cachedToken: TokenState | null = null;

async function fetchToken(creds: AppraisalCredentials): Promise<TokenState> {
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

function parseContent(content: CommonResponse['content']): AppraisalRaw[] {
  if (Array.isArray(content)) return content;
  if (typeof content === 'string' && content.trim().length > 0) {
    const parsed = JSON.parse(content);
    return Array.isArray(parsed) ? parsed : [];
  }
  return [];
}

function toNumber(s: string | null): number | null {
  if (s === null || s.trim() === '') return null;
  const n = Number(s);
  return Number.isNaN(n) ? null : n;
}

function toBool(s: string | null): boolean {
  return typeof s === 'string' && s.trim().toLowerCase() === 'yes';
}

// Mirrors rayontaraApiPlugin.ts's approach exactly: this endpoint's response has no employee
// identifier either, but DOES filter to a single record when queried with a specific EmpId
// (confirmed live: {"EmpId":"1104"} returns exactly Neetu Singh's appraisal record, with an
// Amount matching her known Gross Salary) — so the code is attached from the outgoing request.
//
// Confirmed live: Amount now comes back AES-encrypted (same scheme as GetLastTwoAppraisals'
// Salary field — see vite-plugins/koenigDecryption.ts) rather than the plain number it used to
// be. Decrypted values cross-checked against every previously-known-good plaintext figure for
// this API (e.g. code 4 -> 250000, code 1 -> 2500000) and matched exactly, confirming Koenig
// switched this field's encoding without changing its meaning.
async function fetchAppraisalByCode(
  creds: AppraisalCredentials,
  token: TokenState,
  code: number,
): Promise<AppraisalRecord | null> {
  const url = `${creds.base}/api/Kites/Operator/common?apikey=${encodeURIComponent(creds.apiKey)}&accessToken=${encodeURIComponent(token.accessToken)}&deviceToken=${encodeURIComponent(token.deviceToken)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ EmpId: String(code) }),
  });
  if (!res.ok) throw new Error(`common HTTP ${res.status}`);
  const data = (await res.json()) as CommonResponse;
  if (data.statuscode !== 200) throw new Error(`common failed: ${data.message || 'unknown error'}`);
  const [raw] = parseContent(data.content);
  if (!raw) return null;
  return {
    code,
    amount: decryptKoenigValue(raw.Amount, creds.decryptPassword, creds.decryptSalt),
    currency: raw.Currency,
    epf: toNumber(raw.EPF),
    allowNPS: toBool(raw.AllowNPS),
    employeeShare: toNumber(raw.EmployeeShare),
    employerShare: toNumber(raw.EmployerShare),
  };
}

async function fetchAllByCode(creds: AppraisalCredentials, token: TokenState): Promise<AppraisalRecord[]> {
  const results = await Promise.all(
    RAYONTARA_EMP_CODES.map((code) => fetchAppraisalByCode(creds, token, code)),
  );
  return results.filter((r): r is AppraisalRecord => r !== null);
}

async function fetchRayontaraAppraisal(creds: AppraisalCredentials): Promise<AppraisalRecord[]> {
  if (!cachedToken) cachedToken = await fetchToken(creds);
  try {
    return await fetchAllByCode(creds, cachedToken);
  } catch {
    cachedToken = await fetchToken(creds);
    return await fetchAllByCode(creds, cachedToken);
  }
}

// Koenig's Emp Codes are recovered dynamically (see rayontaraApiPlugin.ts's code-registry scan),
// not a small fixed list like Rayontara's — the caller sends whichever codes it has. Bounded
// concurrency (rather than one big Promise.all) keeps this from opening hundreds of connections
// at once; an isolated failed code is retried rather than immediately given up on (see the retry
// passes in fetchAppraisalForCodes below) — confirmed live that a code missing from one batch run
// (e.g. an intermittent timeout under load) reliably has real data on file when queried alone, so
// treating "missing from this pass" as "no Pay Scale exists" was wrong and cost real employees
// their PF/NPS/Salary for the rest of that session until someone manually re-ran the fetch.
async function fetchAppraisalBatchOnce(
  creds: AppraisalCredentials,
  token: TokenState,
  codes: number[],
): Promise<{ results: AppraisalRecord[]; missing: number[] }> {
  const results: AppraisalRecord[] = [];
  const missing: number[] = [];
  let nextIndex = 0;
  const CONCURRENCY = 25;

  async function worker() {
    while (nextIndex < codes.length) {
      const code = codes[nextIndex++];
      try {
        const record = await fetchAppraisalByCode(creds, token, code);
        if (record) results.push(record);
        else missing.push(code);
      } catch {
        missing.push(code);
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return { results, missing };
}

// Up to 2 retry passes over whatever's still missing after the previous pass — each pass is much
// smaller than the full batch, so the concurrent load that likely caused the miss in the first
// place is far lower, and a code genuinely absent from the API (as opposed to just timed out)
// keeps returning null/failing every pass and is correctly dropped once retries are exhausted.
const APPRAISAL_MAX_RETRY_PASSES = 2;

async function fetchAppraisalForCodes(
  creds: AppraisalCredentials,
  token: TokenState,
  codes: number[],
): Promise<AppraisalRecord[]> {
  const allResults: AppraisalRecord[] = [];
  let pending = codes;
  let pass = 0;
  let firstPassFailureCount = 0;

  while (pending.length > 0 && pass <= APPRAISAL_MAX_RETRY_PASSES) {
    const { results, missing } = await fetchAppraisalBatchOnce(creds, token, pending);
    allResults.push(...results);
    if (pass === 0) firstPassFailureCount = missing.length;
    pending = missing;
    pass++;
  }

  // A high failure rate on the very first pass means the cached token likely expired mid-batch
  // (or the API went down) rather than a handful of bad codes — bail out so
  // fetchAppraisalForKoenig's retry wrapper refreshes the token, instead of silently caching an
  // empty/mostly-empty result that then looks like every employee has no Pay Scale on file. Same
  // reasoning as scanCodeUniverse in vite-plugins/rayontaraApiPlugin.ts. Judged on the first pass
  // only — by design, most of that count is expected to resolve in the retry passes above.
  if (codes.length > 0 && firstPassFailureCount > codes.length * 0.2) {
    throw new Error(`Appraisal batch aborted: ${firstPassFailureCount}/${codes.length} lookups failed on first pass`);
  }
  return allResults;
}

export async function fetchAppraisalForKoenig(creds: AppraisalCredentials, codes: number[]): Promise<AppraisalRecord[]> {
  if (!cachedToken) cachedToken = await fetchToken(creds);
  try {
    return await fetchAppraisalForCodes(creds, cachedToken, codes);
  } catch {
    cachedToken = await fetchToken(creds);
    return await fetchAppraisalForCodes(creds, cachedToken, codes);
  }
}

function registerMiddleware(server: ViteDevServer | PreviewServer, creds: AppraisalCredentials) {
  server.middlewares.use('/api/rayontara/appraisal', (_req, res) => {
    res.setHeader('Content-Type', 'application/json');
    fetchRayontaraAppraisal(creds)
      .then((records) => {
        res.statusCode = 200;
        res.end(JSON.stringify({ ok: true, records }));
      })
      .catch((err: unknown) => {
        // eslint-disable-next-line no-console
        console.error('[rayontara-appraisal-api]', err);
        res.statusCode = 502;
        const message = err instanceof Error ? err.message : 'Unknown error contacting Appraisal API';
        res.end(JSON.stringify({ ok: false, error: message }));
      });
  });
}

// Unlike the GET-based /api/rayontara/appraisal above (a fixed, known code list needs no input
// from the browser), the Koenig code list is only known client-side (it comes from whichever
// employees the PMS code-recovery scan matched) — so this reads a JSON body of codes from the
// request instead. Vite's middleware stack doesn't parse bodies by default, hence the manual
// stream read.
function registerKoenigMiddleware(server: ViteDevServer | PreviewServer, creds: AppraisalCredentials) {
  server.middlewares.use('/api/koenig/appraisal', (req, res) => {
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
      fetchAppraisalForKoenig(creds, codes)
        .then((records) => {
          res.statusCode = 200;
          res.end(JSON.stringify({ ok: true, records }));
        })
        .catch((err: unknown) => {
          // eslint-disable-next-line no-console
          console.error('[koenig-appraisal-api]', err);
          res.statusCode = 502;
          const message = err instanceof Error ? err.message : 'Unknown error contacting Appraisal API';
          res.end(JSON.stringify({ ok: false, error: message }));
        });
    });
  });
}

export function rayontaraAppraisalApiPlugin(creds: AppraisalCredentials): Plugin {
  verifyKoenigDecryption(creds.decryptPassword, creds.decryptSalt);
  return {
    name: 'rayontara-appraisal-api',
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
