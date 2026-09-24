import { decryptKoenigValue } from './koenigDecryption.js';
import { withCachedToken } from './tokenCache.js';

// Ported from vite-plugins/rayontaraArrearApiPlugin.ts (minus the Vite middleware wiring).

export interface ArrearCredentials {
  base: string;
  username: string;
  password: string;
  role: string;
  apiKey: string;
  decryptPassword: string;
  decryptSalt: string;
}

// New/old salary plus the two dates needed to decide which month (if any) an arrear falls due —
// the actual per-month arithmetic is done client-side in src/utils/arrearCalculation.ts, since
// this API isn't month-scoped at all.
export interface ArrearRecord {
  code: number;
  newSalary: number | null;
  oldSalary: number | null;
  appraisalDate: string | null;
  createdDate: string | null;
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

// Confirmed live: Salary comes back AES-encrypted, not a plain number. Decryption is the shared
// Koenig scheme (see api/_lib/koenigDecryption.ts).
function decryptSalary(cipherB64: string | null, creds: ArrearCredentials): number | null {
  return decryptKoenigValue(cipherB64, creds.decryptPassword, creds.decryptSalt);
}

interface ArrearRaw {
  AppraisalDate: string | null;
  NextAppraisalDate: string | null;
  Salary: string | null;
  CreatedDate: string | null;
}

interface CommonResponse {
  statuscode: number;
  message: string;
  content: string | ArrearRaw[] | null;
}

async function fetchToken(creds: ArrearCredentials): Promise<TokenState> {
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

function parseContent(content: CommonResponse['content']): ArrearRaw[] {
  if (Array.isArray(content)) return content;
  if (typeof content === 'string' && content.trim().length > 0) {
    const parsed = JSON.parse(content);
    return Array.isArray(parsed) ? parsed : [];
  }
  return [];
}

// The API's own ordering isn't documented, so this sorts explicitly by AppraisalDate descending
// rather than trusting array order — entry[0] is then always the current/latest appraisal,
// entry[1] (if present) the one immediately before it.
function sortByAppraisalDateDesc(raws: ArrearRaw[]): ArrearRaw[] {
  return [...raws].sort((a, b) => {
    const ta = a.AppraisalDate ? new Date(a.AppraisalDate).getTime() : -Infinity;
    const tb = b.AppraisalDate ? new Date(b.AppraisalDate).getTime() : -Infinity;
    return tb - ta;
  });
}

async function fetchArrearForCode(creds: ArrearCredentials, token: TokenState, code: number): Promise<ArrearRecord | null> {
  const url = `${creds.base}/api/Kites/Operator/common?apikey=${encodeURIComponent(creds.apiKey)}&accessToken=${encodeURIComponent(token.accessToken)}&deviceToken=${encodeURIComponent(token.deviceToken)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ EmpId: String(code) }),
  });
  if (!res.ok) throw new Error(`common HTTP ${res.status}`);
  const data = (await res.json()) as CommonResponse;
  if (data.statuscode !== 200) throw new Error(`common failed (${data.statuscode}): ${data.message || 'unknown error'}`);
  const sorted = sortByAppraisalDateDesc(parseContent(data.content));
  const latest = sorted[0];
  if (!latest) return null;
  const previous = sorted[1];
  return {
    code,
    newSalary: decryptSalary(latest.Salary, creds),
    oldSalary: previous ? decryptSalary(previous.Salary, creds) : null,
    appraisalDate: latest.AppraisalDate,
    createdDate: latest.CreatedDate,
  };
}

// Bounded concurrency, same reasoning as the Appraisal/Loan/TDS/Leave/Recovery clients: avoid
// opening hundreds of connections at once, and an isolated failed code shouldn't abort the batch.
async function fetchArrearForCodes(creds: ArrearCredentials, token: TokenState, codes: number[]): Promise<ArrearRecord[]> {
  const results: ArrearRecord[] = [];
  let nextIndex = 0;
  let failures = 0;
  const CONCURRENCY = 25;

  async function worker() {
    while (nextIndex < codes.length) {
      const code = codes[nextIndex++];
      try {
        const record = await fetchArrearForCode(creds, token, code);
        if (record) results.push(record);
      } catch {
        failures++;
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  // A high failure rate means the cached token likely expired mid-batch rather than a handful of
  // bad codes — bail out so the retry wrapper refreshes the token, instead of silently caching an
  // empty result that then looks like nobody has an arrear.
  if (codes.length > 0 && failures > codes.length * 0.2) {
    throw new Error(`Arrear batch aborted: ${failures}/${codes.length} lookups failed`);
  }
  return results;
}

export async function fetchArrearForCodesWithRetry(creds: ArrearCredentials, codes: number[]): Promise<ArrearRecord[]> {
  return withCachedToken('arrear', () => fetchToken(creds), (token) => fetchArrearForCodes(creds, token, codes));
}
