import type { VercelRequest, VercelResponse } from '@vercel/node';
import employees from '../_lib/routes/globalEmployees';
import wfh from '../_lib/routes/globalWfh';

// One serverless function fanning out to every /api/global/* route by its [action] path segment —
// see api/auth/[action].ts for why (Vercel's Hobby plan 12-function cap).
const routes: Record<string, (req: VercelRequest, res: VercelResponse) => unknown> = {
  employees,
  wfh,
};

export default function handler(req: VercelRequest, res: VercelResponse) {
  const action = typeof req.query.action === 'string' ? req.query.action : '';
  const route = routes[action];
  if (!route) {
    res.status(404).json({ ok: false, error: 'Not found' });
    return;
  }
  return route(req, res);
}
