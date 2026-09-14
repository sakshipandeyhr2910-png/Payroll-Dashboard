// Shared low-level PMS ("Get Employee Details" / Kites Operator "common") client pieces, ported
// from vite-plugins/rayontaraApiPlugin.ts. Used by api/rayontara/employees.ts,
// api/koenig/employees.ts, api/global/employees.ts, and scripts/warmCodeUniverse.ts (the
// out-of-band code-universe scan, which needs the same token exchange + per-code fetch as the
// live handlers).

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

export type PmsEmployeeRaw = Omit<PmsEmployee, 'code'>;

export interface TokenState {
  accessToken: string;
  deviceToken: string;
}

interface GetTokenResponse {
  statuscode: number;
  message: string;
  content: { accessToken: string; deviceToken: string; Username: string; Role: string } | null;
}

interface CommonResponse {
  statuscode: number;
  message: string;
  content: string | PmsEmployeeRaw[] | null;
}

export async function fetchToken(creds: PmsCredentials): Promise<TokenState> {
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

// The PMS "common" endpoint's response schema has no employee-code field at all (confirmed
// against the live API), so there is no way to recover it from a bulk emp_code:"" call.
// It DOES, however, filter to a single matching record when queried with a specific emp_code
// (confirmed live: {"emp_code":"1104"} returns exactly Neetu Singh's record). So the code is
// recovered from the OUTGOING request, not the response — we query per known code and attach the
// code we asked for to the record that comes back.
export async function fetchEmployeeByCode(
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

// Confirmed live: Is_rayontara/Is_oversease use "true"/"false" strings, but Is_global uses
// "Yes"/"No" instead — same boolean meaning, different encoding, so both are accepted here.
export function toBool(v: string | null | undefined): boolean {
  if (typeof v !== 'string') return false;
  const s = v.trim().toLowerCase();
  return s === 'true' || s === 'yes';
}

export function normalizeName(e: { first_name: string | null; middle_name: string | null; last_name: string | null }): string {
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
export function normalizeDoj(iso: string | null): string {
  return iso ? iso.slice(0, 10) : '';
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
export function cleanBulkEmployees(raw: PmsEmployeeRaw[]): PmsEmployeeRaw[] {
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

export async function fetchAllEmployeesBulk(creds: PmsCredentials, token: TokenState): Promise<PmsEmployeeRaw[]> {
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
// entity and must not appear under Koenig (or Rayontara). These bulk-returned records have no Emp
// Code at all, so — unlike Rayontara — there's no way to key the Appraisal/Loan/Meal/Recovery APIs
// off these rows; only PMS employee-master fields are available for them.
export async function fetchAllKoenigEmployees(creds: PmsCredentials, token: TokenState): Promise<PmsEmployeeRaw[]> {
  const all = await fetchAllEmployeesBulk(creds, token);
  return all.filter((e) => !toBool(e.Is_rayontara) && !toBool(e.Is_oversease) && !toBool(e.Is_global));
}

// Global = Is_global=true (or "Yes" — the API encodes this flag differently from
// Is_rayontara/Is_oversease, see toBool above), independent of Is_rayontara/Is_oversease — per
// explicit instruction, a Global-flagged employee belongs ONLY to Global and must not appear
// under Koenig or Rayontara.
export async function fetchAllGlobalEmployees(creds: PmsCredentials, token: TokenState): Promise<PmsEmployeeRaw[]> {
  const all = await fetchAllEmployeesBulk(creds, token);
  return all.filter((e) => toBool(e.Is_global));
}
