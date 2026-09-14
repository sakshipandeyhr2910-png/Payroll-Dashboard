import type { Plugin, ViteDevServer, PreviewServer } from 'vite';
import { RAYONTARA_EMP_CODES } from './rayontaraEmpCodes';

export interface PmsCredentials {
  base: string;
  username: string;
  password: string;
  role: string;
  apiKey: string;
}

export interface PmsEmployee {
  code: number;
  first_name: string | null;
  middle_name: string | null;
  last_name: string | null;
  city_name: string | null;
  country_name: string | null;
  state_name: string | null;
  address_details: string | null;
  address_pin_code: string | null;
  email_address: string | null;
  manager_name: string | null;
  deparment_name: string | null;
  designation_name: string | null;
  date_of_joining: string | null;
  official_phone_number: string | null;
  personal_phone_number: string | null;
  bank_account: string | null;
  bank_name: string | null;
  ifsc_code: string | null;
  present_address: string | null;
  date_of_resigantion: string | null;
  last_working_day: string | null;
  UAN: string | null;
  Is_oversease: string | null;
  Is_rayontara: string | null;
  Is_global: string | null;
  // Confirmed live: unlike the Is_* flags (all strings), this comes through as a raw JSON number.
  working_days: string | number | null;
  Is_blue_collared_job: string | null;
}

// The PMS "common" endpoint's response schema has no employee-code field at all (confirmed
// against the live API), so there is no way to recover it from a bulk emp_code:"" call.
// It DOES, however, filter to a single matching record when queried with a specific emp_code
// (confirmed live: {"emp_code":"1104"} returns exactly Neetu Singh's record). So the code is
// recovered from the OUTGOING request, not the response — we query per known Rayontara code
// and attach the code we asked for to the record that comes back.

interface TokenState {
  accessToken: string;
  deviceToken: string;
}

interface GetTokenResponse {
  statuscode: number;
  message: string;
  content: { accessToken: string; deviceToken: string; Username: string; Role: string } | null;
}

type PmsEmployeeRaw = Omit<PmsEmployee, 'code'>;

interface CommonResponse {
  statuscode: number;
  message: string;
  content: string | PmsEmployeeRaw[] | null;
}

// Cached in-memory for the life of the dev/preview server process — avoids re-authenticating on every page load.
let cachedToken: TokenState | null = null;

async function fetchToken(creds: PmsCredentials): Promise<TokenState> {
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

// The API's "content" field is itself a JSON-encoded string containing the employee array (double-encoded).
function parseEmployeeContent(content: CommonResponse['content']): PmsEmployeeRaw[] {
  if (Array.isArray(content)) return content;
  if (typeof content === 'string' && content.trim().length > 0) {
    const parsed = JSON.parse(content);
    return Array.isArray(parsed) ? parsed : [];
  }
  return [];
}

async function fetchEmployeeByCode(
  creds: PmsCredentials,
  token: TokenState,
  code: number,
): Promise<PmsEmployee | null> {
  const url = `${creds.base}/api/Kites/Operator/common?apikey=${encodeURIComponent(creds.apiKey)}&accessToken=${encodeURIComponent(token.accessToken)}&deviceToken=${encodeURIComponent(token.deviceToken)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ emp_code: String(code) }),
  });
  if (!res.ok) throw new Error(`common HTTP ${res.status}`);
  const data = (await res.json()) as CommonResponse;
  if (data.statuscode !== 200) throw new Error(`common failed: ${data.message || 'unknown error'}`);
  const [raw] = parseEmployeeContent(data.content);
  return raw ? { ...raw, code } : null;
}

async function fetchAllByCode(creds: PmsCredentials, token: TokenState): Promise<PmsEmployee[]> {
  const results = await Promise.all(
    RAYONTARA_EMP_CODES.map((code) => fetchEmployeeByCode(creds, token, code)),
  );
  // Is_global=true means the employee belongs only to the Global entity — even one of the
  // fixed Rayontara codes must be dropped here rather than shown under Rayontara.
  return results.filter((e): e is PmsEmployee => e !== null && !toBool(e.Is_global));
}

async function fetchRayontaraEmployees(creds: PmsCredentials): Promise<PmsEmployee[]> {
  if (!cachedToken) cachedToken = await fetchToken(creds);
  try {
    return await fetchAllByCode(creds, cachedToken);
  } catch {
    // Token may have expired — refresh once and retry.
    cachedToken = await fetchToken(creds);
    return await fetchAllByCode(creds, cachedToken);
  }
}

// Confirmed live: Is_rayontara/Is_oversease use "true"/"false" strings, but Is_global uses
// "Yes"/"No" instead — same boolean meaning, different encoding, so both are accepted here.
function toBool(v: string | null | undefined): boolean {
  if (typeof v !== 'string') return false;
  const s = v.trim().toLowerCase();
  return s === 'true' || s === 'yes';
}

// Confirmed live: a blank emp_code returns every employee in the system (578 records) in one
// call — unlike the per-code path above, none of them carry an Emp Code in the response, so
// there is nothing to attach here the way fetchEmployeeByCode does.
// The bulk employee-master response has two known classes of noise, confirmed live:
// 1. At least one outright bogus/test record ("System Response" — a corrupted, non-name string
//    with a designation but no joining date at all). Every genuine employee has a
//    date_of_joining; that's a safe, unique signal to drop it rather than show a
//    "—"-filled row for something that isn't an employee.
// 2. Malformed DUPLICATE records for real people: the same person appears twice with the exact
//    same name+DOJ — once correctly split across first/middle/last name, once with the whole name
//    jammed into first_name and middle_name/last_name literally null (not empty string — a
//    genuine record always has at least one of those, even if blank). Confirmed live this
//    reflects real duplication in Koenig's own PMS data (some of these pairs even have a second,
//    genuinely separate Emp Code registered for the same person+DOJ — not something we can safely
//    resolve by guessing which code is "theirs"), but the malformed twin itself adds nothing but a
//    confusing, all-dashes duplicate row and is safe to drop outright.
function cleanBulkEmployees(raw: PmsEmployeeRaw[]): PmsEmployeeRaw[] {
  const withDoj = raw.filter((e) => !!e.date_of_joining);
  const wellFormedKeys = new Set(
    withDoj
      .filter((e) => e.middle_name !== null || e.last_name !== null)
      .map((e) => `${normalizeName(e)}|${normalizeDoj(e.date_of_joining)}`),
  );
  return withDoj.filter((e) => {
    const isMalformed = e.middle_name === null && e.last_name === null;
    if (!isMalformed) return true;
    return !wellFormedKeys.has(`${normalizeName(e)}|${normalizeDoj(e.date_of_joining)}`);
  });
}

async function fetchAllEmployeesBulk(creds: PmsCredentials, token: TokenState): Promise<PmsEmployeeRaw[]> {
  const url = `${creds.base}/api/Kites/Operator/common?apikey=${encodeURIComponent(creds.apiKey)}&accessToken=${encodeURIComponent(token.accessToken)}&deviceToken=${encodeURIComponent(token.deviceToken)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ emp_code: '' }),
  });
  if (!res.ok) throw new Error(`common HTTP ${res.status}`);
  const data = (await res.json()) as CommonResponse;
  if (data.statuscode !== 200) throw new Error(`common failed: ${data.message || 'unknown error'}`);
  return cleanBulkEmployees(parseEmployeeContent(data.content));
}

// Koenig = every employee who is neither Rayontara, overseas, nor Global, per explicit
// instruction to use the API's own Is_rayontara / Is_oversease / Is_global flags directly rather
// than inferring from country. Is_global=true means the employee belongs only to the Global
// entity and must not appear under Koenig (or Rayontara — see fetchAllByCode above). These
// bulk-returned records have no Emp Code at all, so — unlike Rayontara — there's no way to key
// the Appraisal/Loan/Meal/Recovery APIs off these rows; only PMS employee-master fields are
// available for them.
async function fetchAllKoenigEmployees(creds: PmsCredentials, token: TokenState): Promise<PmsEmployeeRaw[]> {
  const all = await fetchAllEmployeesBulk(creds, token);
  return all.filter((e) => !toBool(e.Is_rayontara) && !toBool(e.Is_oversease) && !toBool(e.Is_global));
}

async function fetchKoenigEmployees(creds: PmsCredentials): Promise<PmsEmployeeRaw[]> {
  if (!cachedToken) cachedToken = await fetchToken(creds);
  try {
    return await fetchAllKoenigEmployees(creds, cachedToken);
  } catch {
    cachedToken = await fetchToken(creds);
    return await fetchAllKoenigEmployees(creds, cachedToken);
  }
}

// The bulk endpoint never returns an Emp Code, but the per-code endpoint (used for Rayontara
// above) does confirm/deny individual codes one at a time. Live probing found the whole
// company's codes are NOT scattered across an unbounded space — they cluster densely in two
// bands (roughly 1–4,850 and 10,000–10,070; empty everywhere else tested up to 30,000), so
// scanning that bounded range and recording which codes hit is tractable (~10k calls, well
// under a minute at concurrency 25). This recovers REAL Emp Codes — it's a lookup, not a guess.
// A plain full-name match resolves most employees, but common Indian names collide across a
// company this size (confirmed live: 5 different real people are all named "Gurpreet Kaur") —
// for those, date_of_joining (also returned by the per-code endpoint) acts as a second key, since
// two different employees sharing both an identical name AND an identical joining date is
// vanishingly unlikely. A match is only trusted when it's unique even after that; anything still
// ambiguous is left unmatched rather than risking attaching the wrong person's code (and thus
// their Pay Scale/Loan/etc. from the other APIs) to someone else's row.
const KOENIG_CODE_SCAN_MIN = 1;
const KOENIG_CODE_SCAN_MAX = 10100;
const KOENIG_CODE_SCAN_CONCURRENCY = 25;

export interface KoenigEmployeeWithCode extends PmsEmployeeRaw {
  code: number | null;
}

function normalizeName(e: { first_name: string | null; middle_name: string | null; last_name: string | null }): string {
  return [e.first_name, e.middle_name, e.last_name]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// date_of_joining is an ISO datetime string with an always-midnight time component (e.g.
// "2024-10-01T00:00:00") — comparing the date portion only is enough and avoids any theoretical
// timezone-formatting mismatch between the two endpoints.
function normalizeDoj(iso: string | null): string {
  return iso ? iso.slice(0, 10) : '';
}

interface CodeUniverse {
  // Plain full-name match — works whenever a name is unique across every scanned code.
  nameToCodes: Map<string, number[]>;
  // name+DOJ composite match — resolves the common case where two *different* real employees
  // happen to share a name (verified live: e.g. 5 different people are all named "Gurpreet
  // Kaur"), since their joining dates essentially never coincide too. Only used to disambiguate
  // when the plain name isn't already unique.
  nameDojToCodes: Map<string, number[]>;
  // Full record per scanned code — lets an ambiguous name(+DOJ) match with more than one
  // candidate code be resolved by inspecting what's actually behind each code, rather than always
  // giving up (see resolveAmbiguous below).
  codeDetails: Map<number, PmsEmployee>;
}

function addTo(map: Map<string, number[]>, key: string, code: number) {
  const existing = map.get(key);
  if (existing) existing.push(code);
  else map.set(key, [code]);
}

async function scanCodesOnce(
  creds: PmsCredentials,
  token: TokenState,
  codes: number[],
  nameToCodes: Map<string, number[]>,
  nameDojToCodes: Map<string, number[]>,
  codeDetails: Map<number, PmsEmployee>,
): Promise<number[]> {
  const errored: number[] = [];
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < codes.length) {
      const code = codes[nextIndex++];
      try {
        const employee = await fetchEmployeeByCode(creds, token, code);
        if (!employee) continue;
        const key = normalizeName(employee);
        if (!key) continue;
        addTo(nameToCodes, key, code);
        addTo(nameDojToCodes, `${key}|${normalizeDoj(employee.date_of_joining)}`, code);
        codeDetails.set(code, employee);
      } catch {
        errored.push(code);
      }
    }
  }

  await Promise.all(Array.from({ length: KOENIG_CODE_SCAN_CONCURRENCY }, worker));
  return errored;
}

// This universe is cached for the entire life of the server process (see getCodeUniverse below),
// so a code that transiently errors on this ONE scan (a dropped connection, a slow response under
// concurrency 25 — nothing to do with whether that code is a real employee) would otherwise stay
// permanently unmatched until someone manually restarts the server — confirmed live: employees
// whose code errored out of a scan showed Emp Code "—" indefinitely, and a fresh scan run moments
// later (same server, same codes) found them cleanly. Retrying just the errored codes, in ever-
// smaller batches, fixes this the same way fetchAppraisalForCodes retries missed employees above.
const CODE_SCAN_MAX_RETRY_PASSES = 2;

async function scanCodeUniverse(creds: PmsCredentials, token: TokenState): Promise<CodeUniverse> {
  const nameToCodes = new Map<string, number[]>();
  const nameDojToCodes = new Map<string, number[]>();
  const codeDetails = new Map<number, PmsEmployee>();
  const allCodes: number[] = [];
  for (let c = KOENIG_CODE_SCAN_MIN; c <= KOENIG_CODE_SCAN_MAX; c++) allCodes.push(c);

  let pending = allCodes;
  let pass = 0;
  let firstPassFailureCount = 0;
  while (pending.length > 0 && pass <= CODE_SCAN_MAX_RETRY_PASSES) {
    const errored = await scanCodesOnce(creds, token, pending, nameToCodes, nameDojToCodes, codeDetails);
    if (pass === 0) firstPassFailureCount = errored.length;
    pending = errored;
    pass++;
  }

  // A high failure rate on the very first pass means the token likely died mid-scan (or the API
  // went down) rather than a handful of bad records — bail out so the caller retries with a fresh
  // token instead of silently caching a mostly-empty universe. Judged on the first pass only, same
  // reasoning as fetchAppraisalForCodes: most of that count is expected to resolve in retries.
  if (firstPassFailureCount > allCodes.length * 0.2) {
    throw new Error(`Code scan aborted: ${firstPassFailureCount}/${allCodes.length} lookups failed on first pass`);
  }
  return { nameToCodes, nameDojToCodes, codeDetails };
}

// Cached for the life of the dev/preview server process — the scan is expensive enough (~10k
// API calls) that it should only ever run once, not on every page load.
let cachedCodeUniverse: Promise<CodeUniverse> | null = null;

async function getCodeUniverse(creds: PmsCredentials): Promise<CodeUniverse> {
  if (cachedCodeUniverse) return cachedCodeUniverse;
  const run = (async () => {
    if (!cachedToken) cachedToken = await fetchToken(creds);
    try {
      return await scanCodeUniverse(creds, cachedToken);
    } catch {
      cachedToken = await fetchToken(creds);
      return await scanCodeUniverse(creds, cachedToken);
    }
  })();
  cachedCodeUniverse = run.catch((err) => {
    cachedCodeUniverse = null; // let the next request retry rather than caching a failure forever
    throw err;
  });
  return cachedCodeUniverse;
}

// A record with no designation AND no department at all isn't a genuine second registration —
// confirmed live: several "duplicate" codes for an otherwise uniquely-identified employee turn
// out to have every field but the name blank (no designation, department, bank, IFSC, UAN,
// manager — literally nothing else on file). That's an empty stub, not a second real employee.
function isHollowStub(e: PmsEmployee): boolean {
  return e.designation_name === null && e.deparment_name === null;
}

// Narrows an ambiguous set of candidate codes (same name, and — when called from the DOJ branch
// below — same joining date too) down to one, using signals that distinguish a genuinely
//*different* second employee from noise around the *same* employee, rather than ever guessing
// between two equally-plausible different people:
//   1. Drop hollow stubs (see above) — confirmed live these are pure noise, never the "other"
//      real registration.
//   2. If exactly one candidate remains, it's not ambiguous anymore — that IS the wrong feed
//      splitting one real employee across multiple listings, or the true content behind an
//      accidental duplicate; there's nothing left to guess.
//   3. Otherwise, if candidates split into resigned vs. still-active (date_of_resigantion unset),
//      and exactly one is active — confirmed live this is a genuine resigned-then-rejoined case
//      (the old and new codes share the same bank account/UAN, just a different manager/
//      designation) — the active one is the current, correct code; the resigned one is a stale
//      past employment record under a different code, not this employee's current identity.
//   4. Any other shape (e.g. two active, non-stub candidates) is genuinely undecidable — two
//      different real people can share a name and DOJ (rare, but seen live) and guessing between
//      them risks attaching one person's bank/PF details to someone else, so this still returns
//      null rather than picking one.
function resolveAmbiguous(candidates: number[], universe: CodeUniverse): number | null {
  if (candidates.length === 1) return candidates[0];
  const withDetails = candidates
    .map((code) => ({ code, details: universe.codeDetails.get(code) }))
    .filter((c): c is { code: number; details: PmsEmployee } => !!c.details);

  const nonStub = withDetails.filter((c) => !isHollowStub(c.details));
  if (nonStub.length === 1) return nonStub[0].code;
  const pool = nonStub.length > 0 ? nonStub : withDetails;

  const active = pool.filter((c) => !c.details.date_of_resigantion);
  if (active.length === 1) return active[0].code;

  return null;
}

// Try the composite name+DOJ key first (resolves same-name collisions between different people);
// fall back to plain name only when that alone is already unique. Either branch defers to
// resolveAmbiguous when more than one code matches, rather than immediately giving up.
function matchEmployeeCode(e: PmsEmployeeRaw, universe: CodeUniverse): number | null {
  const key = normalizeName(e);
  if (!key) return null;
  // Once there's at least one DOJ-scoped candidate, resolution stays scoped to that set — never
  // falls through to the broader (DOJ-ignoring) name-only set, which could span genuinely
  // different people with different joining dates and let resolveAmbiguous pick among the wrong
  // pool entirely. The name-only fallback below is only for when DOJ-scoped matching finds
  // nothing at all (e.g. a formatting mismatch in how the DOJ string round-trips).
  const dojMatches = universe.nameDojToCodes.get(`${key}|${normalizeDoj(e.date_of_joining)}`);
  if (dojMatches && dojMatches.length > 0) return resolveAmbiguous(dojMatches, universe);
  const nameMatches = universe.nameToCodes.get(key);
  if (nameMatches && nameMatches.length > 0) return resolveAmbiguous(nameMatches, universe);
  return null;
}

async function fetchKoenigEmployeesWithCodes(creds: PmsCredentials): Promise<KoenigEmployeeWithCode[]> {
  const [employees, universe] = await Promise.all([
    fetchKoenigEmployees(creds),
    getCodeUniverse(creds),
  ]);
  return employees.map((e) => ({ ...e, code: matchEmployeeCode(e, universe) }));
}

// Global = Is_global=true (or "Yes" — the API encodes this flag differently from
// Is_rayontara/Is_oversease, see toBool above), independent of Is_rayontara/Is_oversease — per
// explicit instruction, a Global-flagged employee belongs ONLY to Global and must not appear
// under Koenig or Rayontara (see fetchAllKoenigEmployees above and fetchAllByCode's own
// Is_global filter). Same bulk endpoint, same missing-Emp-Code situation, same name/DOJ
// code-recovery scan as Koenig.
async function fetchAllGlobalEmployees(creds: PmsCredentials, token: TokenState): Promise<PmsEmployeeRaw[]> {
  const all = await fetchAllEmployeesBulk(creds, token);
  return all.filter((e) => toBool(e.Is_global));
}

async function fetchGlobalEmployees(creds: PmsCredentials): Promise<PmsEmployeeRaw[]> {
  if (!cachedToken) cachedToken = await fetchToken(creds);
  try {
    return await fetchAllGlobalEmployees(creds, cachedToken);
  } catch {
    cachedToken = await fetchToken(creds);
    return await fetchAllGlobalEmployees(creds, cachedToken);
  }
}

async function fetchGlobalEmployeesWithCodes(creds: PmsCredentials): Promise<KoenigEmployeeWithCode[]> {
  const [employees, universe] = await Promise.all([
    fetchGlobalEmployees(creds),
    getCodeUniverse(creds),
  ]);
  return employees.map((e) => ({ ...e, code: matchEmployeeCode(e, universe) }));
}

function registerMiddleware(server: ViteDevServer | PreviewServer, creds: PmsCredentials) {
  server.middlewares.use('/api/rayontara/employees', (_req, res) => {
    res.setHeader('Content-Type', 'application/json');
    fetchRayontaraEmployees(creds)
      .then((employees) => {
        res.statusCode = 200;
        res.end(JSON.stringify({ ok: true, employees }));
      })
      .catch((err: unknown) => {
        // eslint-disable-next-line no-console
        console.error('[rayontara-pms-api]', err);
        res.statusCode = 502;
        const message = err instanceof Error ? err.message : 'Unknown error contacting PMS API';
        res.end(JSON.stringify({ ok: false, error: message }));
      });
  });
}

function registerKoenigMiddleware(server: ViteDevServer | PreviewServer, creds: PmsCredentials) {
  server.middlewares.use('/api/koenig/employees', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    // getCodeUniverse's scan result is cached for the entire life of the server process (it's
    // ~10k API calls, too expensive to redo on every page load) — but that means a code that
    // couldn't be matched during the one-time scan (a transient miss on the PMS side, or a record
    // that only became queryable there after the scan already ran) stayed permanently unmatched
    // until someone thought to restart the whole dev server. The "Update Employee List" button
    // sends ?refresh=true specifically so a manual refresh can actually fix this class of problem
    // — not just re-fetch the same (possibly still-wrong) cached code matches.
    const forceRefresh = new URL(req.url || '', 'http://localhost').searchParams.get('refresh') === 'true';
    if (forceRefresh) cachedCodeUniverse = null;
    fetchKoenigEmployeesWithCodes(creds)
      .then((employees) => {
        const matched = employees.filter((e) => e.code !== null).length;
        res.statusCode = 200;
        res.end(JSON.stringify({ ok: true, employees, matched, total: employees.length }));
      })
      .catch((err: unknown) => {
        // eslint-disable-next-line no-console
        console.error('[koenig-pms-api]', err);
        res.statusCode = 502;
        const message = err instanceof Error ? err.message : 'Unknown error contacting PMS API';
        res.end(JSON.stringify({ ok: false, error: message }));
      });
  });
}

function registerGlobalMiddleware(server: ViteDevServer | PreviewServer, creds: PmsCredentials) {
  server.middlewares.use('/api/global/employees', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    // Same reasoning as the Koenig handler above — Global also matches codes via the shared,
    // permanently-cached getCodeUniverse() scan.
    const forceRefresh = new URL(req.url || '', 'http://localhost').searchParams.get('refresh') === 'true';
    if (forceRefresh) cachedCodeUniverse = null;
    fetchGlobalEmployeesWithCodes(creds)
      .then((employees) => {
        const matched = employees.filter((e) => e.code !== null).length;
        res.statusCode = 200;
        res.end(JSON.stringify({ ok: true, employees, matched, total: employees.length }));
      })
      .catch((err: unknown) => {
        // eslint-disable-next-line no-console
        console.error('[global-pms-api]', err);
        res.statusCode = 502;
        const message = err instanceof Error ? err.message : 'Unknown error contacting PMS API';
        res.end(JSON.stringify({ ok: false, error: message }));
      });
  });
}

export function rayontaraApiPlugin(creds: PmsCredentials): Plugin {
  return {
    name: 'rayontara-pms-api',
    configureServer(server) {
      registerMiddleware(server, creds);
      registerKoenigMiddleware(server, creds);
      registerGlobalMiddleware(server, creds);
    },
    configurePreviewServer(server) {
      registerMiddleware(server, creds);
      registerKoenigMiddleware(server, creds);
      registerGlobalMiddleware(server, creds);
    },
  };
}
