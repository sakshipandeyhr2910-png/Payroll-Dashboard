import type { VercelRequest } from '@vercel/node';

// @vercel/node parses the request body for us based on Content-Type before the handler runs
// (req.body is already an object for a well-formed 'application/json' request). This just
// normalizes the couple of shapes that show up in practice — a pre-parsed object, a raw JSON
// string (seen when a client omits/mislabels Content-Type), or nothing at all — into a plain
// object, mirroring the old vite-plugins' manual `JSON.parse(body || '{}')` behavior.
//
// Returns `null` to signal "body present but not valid JSON" so callers can respond with the same
// 400 'Invalid JSON body' / 'Invalid request' shape the original Vite middleware used.
export function readJsonBody<T = Record<string, unknown>>(req: VercelRequest): T | null {
  const body = req.body;
  if (body === undefined || body === null || body === '') return {} as T;
  if (typeof body === 'string') {
    try {
      return JSON.parse(body) as T;
    } catch {
      return null;
    }
  }
  if (typeof body === 'object') return body as T;
  return null;
}
