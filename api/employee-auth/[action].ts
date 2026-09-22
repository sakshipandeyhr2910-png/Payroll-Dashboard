import type { VercelRequest, VercelResponse } from '@vercel/node';
import requestOtp from '../_lib/routes/employeeAuthRequestOtp';
import verifyOtp from '../_lib/routes/employeeAuthVerifyOtp';

// One serverless function fanning out to every /api/employee-auth/* route by its [action] path
// segment — see api/auth/[action].ts for why (Vercel's Hobby plan 12-function cap). Both routes
// are deliberately public (no requireAuth) — they ARE the login flow.
const routes: Record<string, (req: VercelRequest, res: VercelResponse) => unknown> = {
  'request-otp': requestOtp,
  'verify-otp': verifyOtp,
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
