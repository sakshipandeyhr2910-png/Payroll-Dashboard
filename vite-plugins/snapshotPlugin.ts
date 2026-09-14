import type { Plugin, ViteDevServer, PreviewServer } from 'vite';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import path from 'path';

// Month-end data freeze. A "snapshot" is the fully computed Payroll Register for one entity, one
// month, exactly as EntityPage.tsx would have rendered it — not raw upstream API responses. That
// distinction matters: raw inputs alone don't guarantee "identical forever" (a later formula fix
// in EntityPage.tsx would silently recompute different numbers from the same frozen inputs). The
// browser already does this computation for the live view, so it POSTs the finished rows here
// once a month is over; every later GET for that entity+month returns exactly those bytes back,
// untouched by any code that ships afterwards.
//
// Storage is one JSON file per entity+month under <project>/.snapshots/ — a plain file, not a
// database, because this is a single local dev server with no DB in the stack; a file survives
// server restarts (the one thing that must outlive this process for "still frozen a year later"
// to hold), which an in-memory cache would not.
//
// Immutability is enforced here, server-side, not trusted to the client: once a file exists for
// a given entity+month, POST is a no-op that returns the existing content unchanged. First write
// wins, permanently — there is deliberately no update/delete endpoint.
const SNAPSHOT_DIR = path.resolve(process.cwd(), '.snapshots');

function snapshotPath(entity: string, month: string): string {
  // entity/month both come from the URL path and are validated against a strict pattern before
  // this is ever called (see registerSnapshotMiddleware) — this only builds the path, it doesn't
  // re-validate, so it must never be reachable with unchecked input.
  return path.join(SNAPSHOT_DIR, entity, `${month}.json`);
}

const ENTITY_PATTERN = /^[a-z0-9-]{1,40}$/;
const MONTH_PATTERN = /^\d{4}-\d{2}$/;

function registerSnapshotMiddleware(server: ViteDevServer | PreviewServer) {
  server.middlewares.use('/api/snapshot/', (req, res) => {
    const url = new URL(req.url || '', 'http://localhost');
    // Mounted at '/api/snapshot/', so url.pathname here is just the bit after that, e.g. '/koenig/2026-07'.
    const parts = url.pathname.split('/').filter(Boolean);
    const [entity, month] = parts;
    res.setHeader('Content-Type', 'application/json');

    if (!entity || !month || !ENTITY_PATTERN.test(entity) || !MONTH_PATTERN.test(month)) {
      res.statusCode = 400;
      res.end(JSON.stringify({ ok: false, error: 'Invalid entity or month' }));
      return;
    }

    const filePath = snapshotPath(entity, month);

    if (req.method === 'GET') {
      if (!existsSync(filePath)) {
        res.statusCode = 200;
        res.end(JSON.stringify({ ok: true, exists: false }));
        return;
      }
      try {
        const rowsJson = readFileSync(filePath, 'utf8');
        res.statusCode = 200;
        res.end(JSON.stringify({ ok: true, exists: true, rowsJson }));
      } catch (err) {
        res.statusCode = 500;
        res.end(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : 'Read failed' }));
      }
      return;
    }

    if (req.method === 'POST') {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        // Already frozen — first write wins. Hand back what's actually on file (not an error) so
        // the caller can't tell "already frozen" apart from "just froze it" and doesn't need to.
        if (existsSync(filePath)) {
          try {
            const rowsJson = readFileSync(filePath, 'utf8');
            res.statusCode = 200;
            res.end(JSON.stringify({ ok: true, alreadyFrozen: true, rowsJson }));
          } catch (err) {
            res.statusCode = 500;
            res.end(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : 'Read failed' }));
          }
          return;
        }
        let parsed: { rowsJson?: string };
        try {
          parsed = JSON.parse(body || '{}');
        } catch {
          res.statusCode = 400;
          res.end(JSON.stringify({ ok: false, error: 'Invalid request body' }));
          return;
        }
        if (typeof parsed.rowsJson !== 'string' || parsed.rowsJson.length === 0) {
          res.statusCode = 400;
          res.end(JSON.stringify({ ok: false, error: 'Missing rowsJson' }));
          return;
        }
        try {
          mkdirSync(path.dirname(filePath), { recursive: true });
          writeFileSync(filePath, parsed.rowsJson, 'utf8');
          res.statusCode = 200;
          res.end(JSON.stringify({ ok: true, alreadyFrozen: false }));
        } catch (err) {
          res.statusCode = 500;
          res.end(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : 'Write failed' }));
        }
      });
      return;
    }

    res.statusCode = 405;
    res.end(JSON.stringify({ ok: false, error: 'Method not allowed' }));
  });
}

export function snapshotPlugin(): Plugin {
  return {
    name: 'payroll-month-end-snapshot',
    configureServer(server) {
      registerSnapshotMiddleware(server);
    },
    configurePreviewServer(server) {
      registerSnapshotMiddleware(server);
    },
  };
}
