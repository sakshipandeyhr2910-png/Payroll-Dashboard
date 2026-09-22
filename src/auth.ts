// Per-tab only (not localStorage) — closing the tab/browser signs you out, which is the right
// default for a dashboard showing bank accounts, UAN and salary data on a shared machine.
const SESSION_KEY = 'dashboard_auth_session';

export interface EmployeeIdentity {
  code: number;
  name: string;
  entitySlug: string;
}

export type LoginResult =
  | { token: string; role: 'hr' }
  | { token: string; role: 'employee'; employee: EmployeeIdentity };

export function getSession(): LoginResult | null {
  const raw = sessionStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as LoginResult;
  } catch {
    return null;
  }
}

export function getToken(): string | null {
  return getSession()?.token ?? null;
}

export function setSession(result: LoginResult): void {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(result));
}

export function clearToken(): void {
  sessionStorage.removeItem(SESSION_KEY);
}

type LoggedOutListener = () => void;
const loggedOutListeners = new Set<LoggedOutListener>();

export function onLoggedOut(listener: LoggedOutListener): () => void {
  loggedOutListeners.add(listener);
  return () => loggedOutListeners.delete(listener);
}

let interceptorInstalled = false;

// Every existing fetch('/api/...') call across the app (there are dozens, scattered across
// src/utils/*Api.ts) needs the session token attached — rather than editing every call site,
// this wraps the global fetch once so every same-origin /api/ request picks it up automatically.
// A 401 means the token was invalidated (logout, or a server restart wiped the in-memory session
// list) — that clears the stored token and notifies the app to fall back to the login screen,
// rather than leaving the UI stuck showing stale "—"/0 data with no explanation. A 403 means the
// session is valid but isn't allowed to call that particular route (e.g. an employee session
// hitting an HR-only endpoint) — that's a real bug in the calling code, not a logout condition, so
// it's left for the caller to handle/display rather than silently signing anyone out.
export function installFetchAuthInterceptor(): void {
  if (interceptorInstalled) return;
  interceptorInstalled = true;
  const originalFetch = window.fetch.bind(window);

  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const isApiCall = url.startsWith('/api/') && !url.startsWith('/api/auth/') && !url.startsWith('/api/employee-auth/');
    if (!isApiCall) return originalFetch(input, init);

    const token = getToken();
    const headers = new Headers(init?.headers);
    if (token) headers.set('Authorization', `Bearer ${token}`);
    const response = await originalFetch(input, { ...init, headers });

    if (response.status === 401) {
      clearToken();
      loggedOutListeners.forEach((listener) => listener());
    }
    return response;
  };
}
