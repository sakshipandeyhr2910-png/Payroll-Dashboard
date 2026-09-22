import type { VercelRequest, VercelResponse } from '@vercel/node';
import payroll from '../_lib/routes/employeePayroll';

// One serverless function fanning out to every /api/employee/* route by its [action] path segment
// — see api/auth/[action].ts for why (Vercel's Hobby plan 12-function cap). Every route under
// here requires an 'employee'-role session (enforced inside each handler via requireAuth(req,
// 'employee')) and derives whose data to return from the verified token alone.
const routes: Record<string, (req: VercelRequest, res: VercelResponse) => unknown> = {
  payroll,
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
