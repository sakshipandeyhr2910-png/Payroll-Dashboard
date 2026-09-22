import type { Plugin, ViteDevServer, PreviewServer } from 'vite';
import type { IncomingMessage } from 'http';
import { randomBytes } from 'crypto';

export interface DashboardAuthCredentials {
  username: string;
  password: string;
}

// A session is either the single shared HR Admin login (full access to every existing route) or
// an individual employee's session, scoped to exactly one Emp Code/entity — issued only after OTP
// verification (see employeeAuthPlugin.ts), never created here. Employee sessions carry their own
// identity so /api/employee/* handlers can derive "whose data is this" from the verified session
// alone, never from anything the client sends — the same boundary api/_lib/auth.ts enforces in
// production.
export type SessionClaims =
  | { role: 'hr' }
  | { role: 'employee'; empCode: number; entitySlug: string; name: string; email: string | null };

// In-memory only, valid for the life of this dev/preview server process — matches the scope of
// "a login screen for this local copy" rather than a durable multi-user auth system. A server
// restart (or an explicit logout) invalidates every outstanding session.
const validSessions = new Map<string, SessionClaims>();

// Exported so employeeAuthPlugin.ts can mint an employee session after OTP verification, and so
// any handler that needs to double check who it's talking to can look a token up directly.
export function registerSession(token: string, claims: SessionClaims): void {
  validSessions.set(token, claims);
}

export function getSessionClaims(token: string): SessionClaims | undefined {
  return validSessions.get(token);
}

export function revokeSession(token: string): void {
  validSessions.delete(token);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => resolve(body));
  });
}

function tokenFromRequest(req: IncomingMessage): string {
  const header = req.headers.authorization || '';
  return header.replace(/^Bearer\s+/i, '');
}

// Route prefixes reachable with no session at all — login endpoints only. Everything else under
// /api/ requires a valid session, and the specific role required depends on the prefix (see the
// gate below).
const PUBLIC_PREFIXES = ['/api/auth/', '/api/employee-auth/'];
// Reserved for the logged-in employee's own data — requires an 'employee' session specifically,
// never 'hr', so an HR Admin session can't be reused here (there's nothing to gain by allowing it:
// HR Admin already has the full bulk endpoints, and this keeps the boundary simple to reason
// about — every request under this prefix is answered using ONLY the session's own empCode/
// entitySlug, never a client-supplied one).
const EMPLOYEE_ONLY_PREFIX = '/api/employee/';

function registerAuthMiddleware(server: ViteDevServer | PreviewServer, creds: DashboardAuthCredentials) {
  server.middlewares.use('/api/auth/login', (req, res) => {
    if (req.method !== 'POST') {
      res.statusCode = 405;
      res.end(JSON.stringify({ ok: false, error: 'Method not allowed' }));
      return;
    }
    readBody(req).then((body) => {
      res.setHeader('Content-Type', 'application/json');
      let parsed: { username?: string; password?: string };
      try {
        parsed = JSON.parse(body || '{}');
      } catch {
        res.statusCode = 400;
        res.end(JSON.stringify({ ok: false, error: 'Invalid request' }));
        return;
      }
      if (parsed.username === creds.username && parsed.password === creds.password) {
        const token = randomBytes(24).toString('hex');
        registerSession(token, { role: 'hr' });
        res.statusCode = 200;
        res.end(JSON.stringify({ ok: true, token, role: 'hr' }));
      } else {
        res.statusCode = 401;
        res.end(JSON.stringify({ ok: false, error: 'Invalid username or password' }));
      }
    });
  });

  server.middlewares.use('/api/auth/logout', (req, res) => {
    revokeSession(tokenFromRequest(req));
    res.setHeader('Content-Type', 'application/json');
    res.statusCode = 200;
    res.end(JSON.stringify({ ok: true }));
  });

  // Gates every other /api/* route behind a valid session, and behind the right ROLE for that
  // route — registered as the FIRST plugin in vite.config.ts (before every entity-specific API
  // plugin), so this runs ahead of all of them. Attaches the verified claims onto the request
  // itself (like any connect-style auth middleware) so a downstream handler — specifically
  // employeeAuthPlugin.ts's /api/employee/* routes — can read req.sessionClaims directly instead
  // of re-deriving the token/session lookup itself.
  server.middlewares.use((req, res, next) => {
    const path = (req.url || '').split('?')[0];
    if (!path.startsWith('/api/') || PUBLIC_PREFIXES.some((p) => path.startsWith(p))) {
      next();
      return;
    }
    const claims = validSessions.get(tokenFromRequest(req));
    if (!claims) {
      res.statusCode = 401;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: false, error: 'Not authenticated' }));
      return;
    }
    const requiredRole = path.startsWith(EMPLOYEE_ONLY_PREFIX) ? 'employee' : 'hr';
    if (claims.role !== requiredRole) {
      // 403, not 401 — the session IS valid, it just isn't allowed here. Critical boundary: an
      // authenticated employee session must never reach the HR bulk endpoints (bank accounts, UAN,
      // every other employee's salary), and an HR session has no reason to hit the single-employee
      // endpoints (which only exist to answer "whose data is this" from the session, not a param).
      res.statusCode = 403;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: false, error: 'Forbidden' }));
      return;
    }
    (req as IncomingMessage & { sessionClaims?: SessionClaims }).sessionClaims = claims;
    next();
  });
}

export function dashboardAuthPlugin(creds: DashboardAuthCredentials): Plugin {
  return {
    name: 'dashboard-auth-gate',
    configureServer(server) {
      registerAuthMiddleware(server, creds);
    },
    configurePreviewServer(server) {
      registerAuthMiddleware(server, creds);
    },
  };
}
