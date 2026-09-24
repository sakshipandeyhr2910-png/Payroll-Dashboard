import type { VercelRequest, VercelResponse } from '@vercel/node';
import { randomBytes } from 'crypto';
import { readJsonBody } from '../readBody.js';
import { resolveIdentifier } from '../employeeLookup.js';
import { verifyOtp } from '../otpStore.js';
import { signSessionToken } from '../auth.js';
import type { PmsCredentials } from '../pmsClient.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Method not allowed' });
    return;
  }
  const parsed = readJsonBody<{ identifier?: string; otp?: string }>(req);
  const identifier = (parsed?.identifier || '').trim();
  const otp = (parsed?.otp || '').trim();
  if (!identifier || !otp) {
    res.status(400).json({ ok: false, error: 'Enter the verification code' });
    return;
  }

  const pmsCreds: PmsCredentials = {
    base: process.env.PMS_API_BASE || '',
    username: process.env.PMS_USERNAME || '',
    password: process.env.PMS_PASSWORD || '',
    role: process.env.PMS_ROLE || '',
    apiKey: process.env.PMS_API_KEY || '',
  };

  try {
    // Re-resolve rather than trusting anything the client sent about who they are — the OTP
    // record itself (looked up by the freshly-resolved Emp Code) is the only source of truth for
    // whether this identifier+code pair is valid.
    const employee = await resolveIdentifier(pmsCreds, identifier);
    if (!employee || !employee.entitySlug) {
      res.status(401).json({ ok: false, error: 'Incorrect or expired code' });
      return;
    }
    const result = await verifyOtp(employee.code, otp);
    if (!result.ok) {
      res.status(result.error.startsWith('Too many') ? 429 : 401).json({ ok: false, error: result.error });
      return;
    }
    if (!process.env.JWT_SECRET) {
      console.error('[employee-auth/verify-otp] JWT_SECRET is not set');
      res.status(500).json({ ok: false, error: 'Server misconfigured' });
      return;
    }
    const jti = randomBytes(16).toString('hex');
    const token = signSessionToken(jti, {
      role: 'employee',
      empCode: result.employee.code,
      entitySlug: result.employee.entitySlug as string,
      name: result.employee.name,
      email: result.employee.email,
    });
    res.status(200).json({
      ok: true,
      token,
      employee: { code: result.employee.code, name: result.employee.name, entitySlug: result.employee.entitySlug },
    });
  } catch (err) {
    console.error('[employee-auth/verify-otp]', err);
    res.status(502).json({ ok: false, error: 'Verification failed. Please try again.' });
  }
}
