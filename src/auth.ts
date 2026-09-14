// Per-tab only (not localStorage) — closing the tab/browser signs you out, which is the right
// default for a dashboard showing bank accounts, UAN and salary data on a shared machine.
const TOKEN_KEY = 'dashboard_auth_token';

export function getToken(): string | null {
  return sessionStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  sessionStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  sessionStorage.removeItem(TOKEN_KEY);
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
// rather than leaving the UI stuck showing stale "—"/0 data with no explanation.
export function installFetchAuthInterceptor(): void {
  if (interceptorInstalled) return;
  interceptorInstalled = true;
  const originalFetch = window.fetch.bind(window);

  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const isApiCall = url.startsWith('/api/') && !url.startsWith('/api/auth/');
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
