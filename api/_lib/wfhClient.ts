import { withCachedToken } from './tokenCache';

// Ported from vite-plugins/rayontaraWfhApiPlugin.ts (minus the Vite middleware wiring). CONFIRMED
// LIVE on 2026-09-17 — the earlier "always empty" result wasn't a data-availability gap, it was
// this request sending the wrong flags: `excludeZero` and `IsAR` must be `"1"` (blank silently
// returns zero rows, no error) and `Option` must be `"All"` (blank/`"Pending"` only surfaces
// requests still awaiting approval, which is why per-EmpId probing during integration kept coming
// back empty even for employees who turned out to have approved claims). Confirmed real records,
// e.g. `{"RequestedBy":3595,"Employee Name":"Elvis Bessah","Accessories":"Internet and
// landline","RequestDate":"2026-08-21","cost":36.00,"IsApproved":1,...}` — so the employee/code
// field is `RequestedBy` (not `EmpId`/`EmpCode`), the amount field is `cost` (lowercase), and there's
// a separate `Accessories` field (what was bought/claimed, e.g. "Internet and landline", "Chat
// GPT") that's surfaced in the Payroll Register's Remarks column, not the reimbursement amount.
export interface WfhCredentials {
  base: string;
  username: string;
  password: string;
  role: string;
  apiKey: string;
}

export interface WfhReimbursementRecord {
  code: number;
  wfhAmount: number;
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

interface WfhReimbursementRaw {
  RequestedBy?: number | string | null;
  EmpId?: number | string | null;
  EmpCode?: number | string | null;
  RequestDate?: string | null;
  RequestedDate?: string | null;
  cost?: number | string | null;
  CostAmount?: number | string | null;
  Amount?: number | string | null;
  ApprovedAmount?: number | string | null;
  ReimbursementAmount?: number | string | null;
  TotalAmount?: number | string | null;
  Accessories?: string | null;
  IsApproved?: number | string | null;
  IsDisapproved?: number | string | null;
  [key: string]: unknown;
}

interface CommonResponse {
  statuscode: number;
  message: string;
  content: string | WfhReimbursementRaw[] | null;
}

async function fetchToken(creds: WfhCredentials): Promise<TokenState> {
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

function parseContent(content: CommonResponse['content']): WfhReimbursementRaw[] {
  if (Array.isArray(content)) return content;
  if (typeof content === 'string' && content.trim().length > 0) {
    const parsed = JSON.parse(content);
    return Array.isArray(parsed) ? parsed : [];
  }
  return [];
}

function firstNumeric(raw: WfhReimbursementRaw, keys: string[]): number | undefined {
  for (const key of keys) {
    const v = raw[key];
    if (v === null || v === undefined || v === '') continue;
    const n = Number(v);
    if (!Number.isNaN(n)) return n;
  }
  return undefined;
}

function firstString(raw: WfhReimbursementRaw, keys: string[]): string | undefined {
  for (const key of keys) {
    const v = raw[key];
    if (typeof v === 'string' && v.trim() !== '') return v;
  }
  return undefined;
}

// Classic ASP.NET/WCF JSON serializers (which this "Kites" API is almost certainly built on, same
// family as every other Koenig integration in this codebase) commonly emit dates as
// "/Date(1699999999000)/" rather than ISO 8601 — handle both.
function parseApiDate(raw: string): Date | null {
  const dotNetMatch = raw.match(/\/Date\((-?\d+)\)\//);
  if (dotNetMatch) {
    const d = new Date(Number(dotNetMatch[1]));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

// "YYYY-MM" in UTC, so a plain "YYYY-MM-DD" Request Date (parsed as UTC midnight by `Date`) isn't
// shifted into the adjacent month by the server's local timezone.
function monthOf(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function isTruthyFlag(v: unknown): boolean {
  if (v === null || v === undefined || v === '') return false;
  const n = Number(v);
  return !Number.isNaN(n) && n !== 0;
}

// Company-wide fetch, not per-EmpCode — the documented request shape takes a date range plus
// optional filters, not a codes array. RequestedDateFrom/To is sent as a server-side pre-filter,
// but every record is ALSO re-checked client-side against its own Request Date (requirement: "no
// reimbursement from another month is displayed") — this doesn't assume the server's date-range
// filter is honored/inclusive/exclusive the way we expect, it just uses it to narrow the payload and
// then decides the month membership itself from the authoritative per-record field. `excludeZero:
// "1"` and `IsAR: "1"` are required — blank returns zero rows with no error. `Option: "All"` is
// required too — blank/"Pending" only returns requests still awaiting approval; "All" returns every
// status, which is why approval is then checked client-side (IsApproved/IsDisapproved) instead of
// trusting the query to have already filtered to payable claims. Amounts are summed per employee
// code for every APPROVED request whose Request Date falls in the selected month, in case more than
// one is submitted in a month (chair + desk + internet), same reasoning as Loan Advance's
// multiple-installment summing; each request's Accessories text is also collected (deduplicated)
// for display in the Payroll Register's Remarks column.
async function fetchWfhReimbursements(
  creds: WfhCredentials,
  token: TokenState,
  selectedMonth: string,
): Promise<WfhReimbursementRecord[]> {
  const [y, m] = selectedMonth.split('-').map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  const dateFrom = `${selectedMonth}-01`;
  const dateTo = `${selectedMonth}-${String(lastDay).padStart(2, '0')}`;

  const url = `${creds.base}/api/Kites/Operator/common?apikey=${encodeURIComponent(creds.apiKey)}&accessToken=${encodeURIComponent(token.accessToken)}&deviceToken=${encodeURIComponent(token.deviceToken)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      EmpId: '',
      ItemId: '',
      ManagerId: '',
      RequestedDateFrom: dateFrom,
      RequestedDateTo: dateTo,
      NotAppr: '',
      NotOrder: '',
      NotDelv: '',
      excludeZero: '1',
      IsAR: '1',
      UserName: '',
      EmpPassword: '',
      Option: 'All',
    }),
  });
  if (!res.ok) throw new Error(`common HTTP ${res.status}`);
  const data = (await res.json()) as CommonResponse;
  if (data.statuscode !== 200) throw new Error(`common failed (${data.statuscode}): ${data.message || 'unknown error'}`);
  const raws = parseContent(data.content);

  const totals = new Map<number, number>();
  const accessoriesByCode = new Map<number, string[]>();
  for (const raw of raws) {
    const code = firstNumeric(raw, ['RequestedBy', 'EmpId', 'EmpCode']);
    const amount = firstNumeric(raw, ['cost', 'CostAmount', 'Amount', 'ApprovedAmount', 'ReimbursementAmount', 'TotalAmount']);
    const dateStr = firstString(raw, ['RequestDate', 'RequestedDate', 'ReqDate', 'RequestedOn']);
    if (code === undefined || amount === undefined || dateStr === undefined) {
      console.error('[wfh-client] Unrecognized record shape — update the key lists in api/_lib/wfhClient.ts:', raw);
      continue;
    }
    const parsedDate = parseApiDate(dateStr);
    if (parsedDate === null) {
      console.error('[wfh-client] Request Date could not be parsed — update parseApiDate in api/_lib/wfhClient.ts:', raw);
      continue;
    }
    // Not an error — most of the server's date-range response (if it even honors the filter) is
    // expected to fall outside this exact month at the range edges; this is the real month gate.
    if (monthOf(parsedDate) !== selectedMonth) continue;
    // Option: "All" returns pending/rejected requests too — only an approved, non-disapproved claim
    // is real money owed to the employee. Not an error, just not payable yet (or ever).
    if (!isTruthyFlag(raw.IsApproved) || isTruthyFlag(raw.IsDisapproved)) continue;
    totals.set(code, (totals.get(code) ?? 0) + amount);
    const accessories = typeof raw.Accessories === 'string' ? raw.Accessories.trim() : '';
    if (accessories) {
      const existing = accessoriesByCode.get(code) ?? [];
      if (!existing.includes(accessories)) existing.push(accessories);
      accessoriesByCode.set(code, existing);
    }
  }
  return Array.from(totals, ([code, wfhAmount]) => ({
    code,
    wfhAmount,
    remarks: (accessoriesByCode.get(code) ?? []).join(', '),
  }));
}

export async function fetchWfhReimbursementsWithRetry(
  creds: WfhCredentials,
  selectedMonth: string,
): Promise<WfhReimbursementRecord[]> {
  return withCachedToken('wfh', () => fetchToken(creds), (token) => fetchWfhReimbursements(creds, token, selectedMonth));
}
