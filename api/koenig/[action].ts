import type { VercelRequest, VercelResponse } from '@vercel/node';
import appraisal from '../_lib/routes/koenigAppraisal.js';
import arrear from '../_lib/routes/koenigArrear.js';
import employees from '../_lib/routes/koenigEmployees.js';
import leave from '../_lib/routes/koenigLeave.js';
import loans from '../_lib/routes/koenigLoans.js';
import recovery from '../_lib/routes/koenigRecovery.js';
import tds from '../_lib/routes/koenigTds.js';

// One serverless function fanning out to every /api/koenig/* route by its [action] path segment —
// see api/auth/[action].ts for why (Vercel's Hobby plan 12-function cap).
const routes: Record<string, (req: VercelRequest, res: VercelResponse) => unknown> = {
  appraisal,
  arrear,
  employees,
  leave,
  loans,
  recovery,
  tds,
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
