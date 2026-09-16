import { withCachedToken } from './tokenCache';

// Ported from vite-plugins/rayontaraWfhApiPlugin.ts (minus the Vite middleware wiring). See that
// file's header comment for the important caveat: the response shape below is a best-effort guess,
// not "confirmed live" like every other client here — live testing during integration returned an
// empty result for every filter combination tried (apparently no WFH Infra Reimbursement request
// has been submitted/approved company-wide yet), so a populated response was never inspected.
// parseRecords logs any record it can't recognize so a real response, whenever one exists, reveals
// the actual field names in the function's logs instead of silently being dropped.

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
  EmpId?: number | string | null;
  EmpCode?: number | string | null;
  Amount?: number | string | null;
  ApprovedAmount?: number | string | null;
  ReimbursementAmount?: number | string | null;
  TotalAmount?: number | string | null;
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

// Company-wide, month-scoped bulk fetch (like Meal Passes), not per-EmpCode — the documented
// request shape takes a date range plus optional filters, not a codes array. Amounts are summed
// per employee in case more than one approved item exists in the month, same reasoning as Loan
// Advance's multiple-installment summing.
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
      excludeZero: '',
      Is1: '',
      UserName: '',
      EmpPassword: '',
      ALL: '',
    }),
  });
  if (!res.ok) throw new Error(`common HTTP ${res.status}`);
  const data = (await res.json()) as CommonResponse;
  if (data.statuscode !== 200) throw new Error(`common failed (${data.statuscode}): ${data.message || 'unknown error'}`);
  const raws = parseContent(data.content);

  const totals = new Map<number, number>();
  for (const raw of raws) {
    const code = firstNumeric(raw, ['EmpId', 'EmpCode']);
    const amount = firstNumeric(raw, ['Amount', 'ApprovedAmount', 'ReimbursementAmount', 'TotalAmount']);
    if (code === undefined || amount === undefined) {
      console.error('[wfh-client] Unrecognized record shape — update the key lists in api/_lib/wfhClient.ts:', raw);
      continue;
    }
    totals.set(code, (totals.get(code) ?? 0) + amount);
  }
  return Array.from(totals, ([code, wfhAmount]) => ({ code, wfhAmount }));
}

export async function fetchWfhReimbursementsWithRetry(
  creds: WfhCredentials,
  selectedMonth: string,
): Promise<WfhReimbursementRecord[]> {
  return withCachedToken('wfh', () => fetchToken(creds), (token) => fetchWfhReimbursements(creds, token, selectedMonth));
}
