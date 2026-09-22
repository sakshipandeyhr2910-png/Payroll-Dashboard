import type { VercelRequest, VercelResponse } from '@vercel/node';
import { randomInt } from 'crypto';
import { readJsonBody } from '../readBody';
import { resolveIdentifier } from '../employeeLookup';
import { checkAndBumpRateLimit, storeOtp } from '../otpStore';
import { sendOtpEmail } from '../mailer';
import type { PmsCredentials } from '../pmsClient';
import type { SmtpCredentials } from '../mailer';

// Ported from vite-plugins/employeeAuthPlugin.ts's '/api/employee-auth/request-otp' handler — see
// that file's header comment for the full identity-resolution/security reasoning (deliberately
// generic response either way, to avoid letting an attacker enumerate valid Employee IDs/emails
// by comparing responses).
const GENERIC_OTP_SENT_MESSAGE = 'If this Employee ID or email is on file, a verification code has been sent to the registered email address.';

function generateOtp(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Method not allowed' });
    return;
  }
  const parsed = readJsonBody<{ identifier?: string }>(req);
  const identifier = (parsed?.identifier || '').trim();
  if (!identifier) {
    res.status(400).json({ ok: false, error: 'Enter your Employee ID or registered email' });
    return;
  }

  const pmsCreds: PmsCredentials = {
    base: process.env.PMS_API_BASE || '',
    username: process.env.PMS_USERNAME || '',
    password: process.env.PMS_PASSWORD || '',
    role: process.env.PMS_ROLE || '',
    apiKey: process.env.PMS_API_KEY || '',
  };
  const smtp: SmtpCredentials = {
    host: process.env.SMTP_HOST || '',
    port: Number(process.env.SMTP_PORT) || 587,
    user: process.env.SMTP_USER || '',
    password: process.env.SMTP_PASSWORD || '',
    from: process.env.SMTP_FROM || '',
  };

  try {
    const employee = await resolveIdentifier(pmsCreds, identifier);
    if (!employee || !employee.email || !employee.entitySlug) {
      if (employee && (!employee.email || !employee.entitySlug)) {
        res.status(200).json({ ok: true, message: 'We could not determine where to send your code. Please contact HR.' });
        return;
      }
      res.status(200).json({ ok: true, message: GENERIC_OTP_SENT_MESSAGE });
      return;
    }
    if (!(await checkAndBumpRateLimit(employee.code))) {
      res.status(429).json({ ok: false, error: 'Too many attempts. Please try again in a few minutes.' });
      return;
    }
    const code = generateOtp();
    await storeOtp(employee, code);
    await sendOtpEmail(smtp, employee.email, employee.name, code);
    res.status(200).json({ ok: true, message: GENERIC_OTP_SENT_MESSAGE });
  } catch (err) {
    console.error('[employee-auth/request-otp]', err);
    res.status(502).json({ ok: false, error: 'Could not send the verification email right now. Please try again shortly.' });
  }
}
