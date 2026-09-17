import type { VercelRequest, VercelResponse } from '@vercel/node';
import login from '../_lib/routes/authLogin';
import logout from '../_lib/routes/authLogout';

// One serverless function fanning out to every /api/auth/* route by its [action] path segment,
// instead of one function per route — Vercel's Hobby plan caps a deployment at 12 functions, and
// this project's ~20 API routes blew well past that when each was its own file (see the sibling
// [action].ts files under koenig/, rayontara/, global/ for the same pattern). Each route's actual
// logic is untouched, just moved under api/_lib/routes/ (which Vercel excludes from routing, same
// as every other file under api/_lib/) so only this dispatcher is a real function.
const routes: Record<string, (req: VercelRequest, res: VercelResponse) => unknown> = {
  login,
  logout,
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
