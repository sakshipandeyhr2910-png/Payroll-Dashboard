import type { VercelRequest, VercelResponse } from '@vercel/node';
import appraisal from '../_lib/routes/rayontaraAppraisal.js';
import arrear from '../_lib/routes/rayontaraArrear.js';
import employees from '../_lib/routes/rayontaraEmployees.js';
import leave from '../_lib/routes/rayontaraLeave.js';
import loans from '../_lib/routes/rayontaraLoans.js';
import mealAllowances from '../_lib/routes/rayontaraMealAllowances.js';
import recovery from '../_lib/routes/rayontaraRecovery.js';
import tds from '../_lib/routes/rayontaraTds.js';

// One serverless function fanning out to every /api/rayontara/* route by its [action] path
// segment — see api/auth/[action].ts for why (Vercel's Hobby plan 12-function cap).
const routes: Record<string, (req: VercelRequest, res: VercelResponse) => unknown> = {
  appraisal,
  arrear,
  employees,
  leave,
  loans,
  'meal-allowances': mealAllowances,
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
