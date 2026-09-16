import type { Plugin, ViteDevServer, PreviewServer } from 'vite';

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

// UNCONFIRMED response shape: live-tested during integration (token exchange succeeds, HTTP 200,
// statuscode 200) but every filter combination tried (blank, ALL/Is1 set, a wide
// RequestedDateFrom/To range, a specific known EmpId) returned an empty result — apparently no WFH
// Infra Reimbursement request has actually been submitted/approved company-wide yet, so there was
// no populated record to confirm real field names against (unlike every other integration in this
// codebase, which has a "confirmed live" comment because a real response was inspected). Field
// names below are a best-effort guess from the request payload's own naming (EmpId, not EmpCode —
// this is the one Kites endpoint that spells it differently) plus the common "Amount" convention
// used elsewhere. parseContent logs any record that doesn't match a guessed key so a real
// response, whenever one exists, immediately shows the actual shape in the server console instead
// of silently dropping it — check that log first if this column stays at 0 once a real WFH request
// exists.
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

let cachedToken: TokenState | null = null;

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

// Company-wide, month-scoped fetch — mirrors Recovery/TDS/Leave's date-scoping, but as a single
// bulk query (like Meal) rather than per-EmpCode, since the documented request shape takes a date
// range plus optional filters, not a codes array. Amounts are summed per employee in case someone
// has more than one approved item in the month (chair + desk + internet, say), same reasoning as
// Loan Advance's multiple-installment summing.
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
      // eslint-disable-next-line no-console
      console.error('[rayontara-wfh-api] Unrecognized record shape — update the key lists in rayontaraWfhApiPlugin.ts:', raw);
      continue;
    }
    totals.set(code, (totals.get(code) ?? 0) + amount);
  }
  return Array.from(totals, ([code, wfhAmount]) => ({ code, wfhAmount }));
}

async function fetchWfhWithRetry(
  creds: WfhCredentials,
  selectedMonth: string,
): Promise<WfhReimbursementRecord[]> {
  if (!cachedToken) cachedToken = await fetchToken(creds);
  try {
    return await fetchWfhReimbursements(creds, cachedToken, selectedMonth);
  } catch {
    cachedToken = await fetchToken(creds);
    return await fetchWfhReimbursements(creds, cachedToken, selectedMonth);
  }
}

function registerMiddleware(server: ViteDevServer | PreviewServer, creds: WfhCredentials) {
  server.middlewares.use('/api/global/wfh', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    const url = new URL(req.url || '', 'http://localhost');
    const selectedMonth = url.searchParams.get('month') || '';
    if (!/^\d{4}-\d{2}$/.test(selectedMonth)) {
      res.statusCode = 400;
      res.end(JSON.stringify({ ok: false, error: 'Missing or invalid ?month=YYYY-MM query parameter' }));
      return;
    }
    fetchWfhWithRetry(creds, selectedMonth)
      .then((records) => {
        res.statusCode = 200;
        res.end(JSON.stringify({ ok: true, records }));
      })
      .catch((err: unknown) => {
        // eslint-disable-next-line no-console
        console.error('[rayontara-wfh-api]', err);
        res.statusCode = 502;
        const message = err instanceof Error ? err.message : 'Unknown error contacting WFH Infra Reimbursement API';
        res.end(JSON.stringify({ ok: false, error: message }));
      });
  });
}

export function rayontaraWfhApiPlugin(creds: WfhCredentials): Plugin {
  return {
    name: 'rayontara-wfh-api',
    configureServer(server) {
      registerMiddleware(server, creds);
    },
    configurePreviewServer(server) {
      registerMiddleware(server, creds);
    },
  };
}
