import type { Plugin, ViteDevServer, PreviewServer } from 'vite';
import type { IncomingMessage } from 'http';
import { randomBytes } from 'crypto';

export interface DashboardAuthCredentials {
  username: string;
  password: string;
}

// In-memory only, valid for the life of this dev/preview server process — this is a single
// shared login for the whole local dashboard (not per-user accounts), matching the scope of
// "add a login screen to this local copy" rather than a full multi-user auth system. A server
// restart (or an explicit logout) invalidates every outstanding session.
const validTokens = new Set<string>();

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
        validTokens.add(token);
        res.statusCode = 200;
        res.end(JSON.stringify({ ok: true, token }));
      } else {
        res.statusCode = 401;
        res.end(JSON.stringify({ ok: false, error: 'Invalid username or password' }));
      }
    });
  });

  server.middlewares.use('/api/auth/logout', (req, res) => {
    validTokens.delete(tokenFromRequest(req));
    res.setHeader('Content-Type', 'application/json');
    res.statusCode = 200;
    res.end(JSON.stringify({ ok: true }));
  });

  // Gates every other /api/* route behind a valid session token. Registered as the FIRST plugin
  // in vite.config.ts (before every entity-specific API plugin), so this runs ahead of all of
  // them — a request without a valid token never reaches the real handler, meaning the payroll
  // data (bank accounts, UAN, salary) is unreachable without logging in first, not just hidden
  // behind the login screen in the UI.
  server.middlewares.use((req, res, next) => {
    const path = (req.url || '').split('?')[0];
    if (!path.startsWith('/api/') || path.startsWith('/api/auth/')) {
      next();
      return;
    }
    if (validTokens.has(tokenFromRequest(req))) {
      next();
      return;
    }
    res.statusCode = 401;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: false, error: 'Not authenticated' }));
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
