import type { Plugin, ViteDevServer, PreviewServer } from 'vite';
import type { IncomingMessage } from 'http';
import { randomBytes, randomInt } from 'crypto';
import nodemailer from 'nodemailer';
import {
  fetchToken,
  fetchEmployeeByCode,
  getCodeUniverse,
  toBool,
  type PmsCredentials,
  type PmsEmployee,
} from './rayontaraApiPlugin';
import { RAYONTARA_EMP_CODES } from './rayontaraEmpCodes';
import { classifyOverseasEmployee } from './overseasEntityMapping';
import { registerSession } from './dashboardAuthPlugin';

export interface SmtpCredentials {
  host: string;
  port: number;
  user: string;
  password: string;
  from: string;
}

// Employee Login identity model: "Employee ID" is the PMS Emp Code (the same number every other
// integration in this app keys off), and "registered email" is the PMS record's own email_address
// (@koenig-solutions.com per every record inspected). Both resolve to the same
// ResolvedEmployee shape, which is all the OTP flow needs to know: who they are, which dashboard
// entity their payroll data lives under, and where to email the code.
interface ResolvedEmployee {
  code: number;
  name: string;
  email: string | null;
  entitySlug: string | null; // null only for an overseas employee classifyOverseasEmployee can't place
}

function fullName(e: PmsEmployee): string {
  return [e.first_name, e.middle_name, e.last_name].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

function classifyEntity(e: PmsEmployee): string | null {
  if (toBool(e.Is_global)) return 'global';
  if (toBool(e.Is_oversease)) return classifyOverseasEmployee(e);
  if (toBool(e.Is_rayontara) || RAYONTARA_EMP_CODES.includes(e.code)) return 'rayontara';
  return 'koenig';
}

function toResolved(e: PmsEmployee): ResolvedEmployee {
  return { code: e.code, name: fullName(e) || `Employee ${e.code}`, email: e.email_address, entitySlug: classifyEntity(e) };
}

async function resolveByCode(creds: PmsCredentials, code: number): Promise<ResolvedEmployee | null> {
  const token = await fetchToken(creds);
  const record = await fetchEmployeeByCode(creds, token, code);
  return record ? toResolved(record) : null;
}

async function resolveByEmail(creds: PmsCredentials, email: string): Promise<ResolvedEmployee | null> {
  const universe = await getCodeUniverse(creds);
  const target = email.trim().toLowerCase();
  for (const record of universe.codeDetails.values()) {
    if (record.email_address && record.email_address.trim().toLowerCase() === target) {
      return toResolved(record);
    }
  }
  return null;
}

async function resolveIdentifier(creds: PmsCredentials, identifier: string): Promise<ResolvedEmployee | null> {
  const trimmed = identifier.trim();
  if (/^\d+$/.test(trimmed)) return resolveByCode(creds, Number(trimmed));
  if (trimmed.includes('@')) return resolveByEmail(creds, trimmed);
  return null;
}

interface OtpRecord {
  code: string;
  employee: ResolvedEmployee;
  attempts: number;
  expiresAt: number;
}

const OTP_TTL_MS = 5 * 60 * 1000;
const MAX_VERIFY_ATTEMPTS = 5;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT_MAX = 5;

// Keyed by resolved Emp Code (not the raw identifier the employee typed), so requesting by ID one
// time and by email the next still hits the same slot for the same person. In-memory only — same
// "life of the dev server process" scope as every other cache in this file's sibling plugins;
// production's equivalent (api/_lib/routes/employeeAuth*.ts) uses Turso so it survives across
// serverless invocations.
const otpStore = new Map<number, OtpRecord>();
const rateLimits = new Map<number, { count: number; windowStart: number }>();

function checkRateLimit(code: number): boolean {
  const now = Date.now();
  const entry = rateLimits.get(code);
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimits.set(code, { count: 1, windowStart: now });
    return true;
  }
  if (entry.count >= RATE_LIMIT_MAX) return false;
  entry.count += 1;
  return true;
}

function generateOtp(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

let transporter: ReturnType<typeof nodemailer.createTransport> | null = null;

function getTransporter(smtp: SmtpCredentials) {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.port === 465,
      requireTLS: smtp.port !== 465,
      auth: { user: smtp.user, pass: smtp.password },
    });
  }
  return transporter;
}

// Throws on failure rather than silently falling back to logging the code — an OTP that only
// "worked" by ending up in a server log isn't meaningfully different from having no OTP check at
// all. If SMTP is unreachable/misconfigured, the caller (the request-otp route below) reports that
// as a real error to the employee rather than pretending the email was sent.
async function sendOtpEmail(smtp: SmtpCredentials, to: string, name: string, code: string): Promise<void> {
  await getTransporter(smtp).sendMail({
    from: smtp.from || smtp.user,
    to,
    subject: 'Your Koenig Payroll Dashboard verification code',
    text: `Hi ${name},\n\nYour one-time verification code is ${code}. It expires in 5 minutes.\n\nIf you did not request this, you can safely ignore this email.`,
    html: `<p>Hi ${name},</p><p>Your one-time verification code is <b style="font-size:22px;letter-spacing:3px;">${code}</b>. It expires in 5 minutes.</p><p>If you did not request this, you can safely ignore this email.</p>`,
  });
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => resolve(body));
  });
}

// Deliberately the same success message whether or not the identifier actually matched an
// employee — an attacker probing Employee IDs/emails should not be able to tell a real one from a
// made-up one by comparing responses.
const GENERIC_OTP_SENT_MESSAGE = 'If this Employee ID or email is on file, a verification code has been sent to the registered email address.';

function registerMiddleware(server: ViteDevServer | PreviewServer, pmsCreds: PmsCredentials, smtp: SmtpCredentials) {
  server.middlewares.use('/api/employee-auth/request-otp', (req, res) => {
    if (req.method !== 'POST') {
      res.statusCode = 405;
      res.end(JSON.stringify({ ok: false, error: 'Method not allowed' }));
      return;
    }
    readBody(req).then(async (body) => {
      res.setHeader('Content-Type', 'application/json');
      let identifier: string;
      try {
        const parsed = JSON.parse(body || '{}') as { identifier?: string };
        identifier = (parsed.identifier || '').trim();
      } catch {
        res.statusCode = 400;
        res.end(JSON.stringify({ ok: false, error: 'Invalid request' }));
        return;
      }
      if (!identifier) {
        res.statusCode = 400;
        res.end(JSON.stringify({ ok: false, error: 'Enter your Employee ID or registered email' }));
        return;
      }
      try {
        const employee = await resolveIdentifier(pmsCreds, identifier);
        if (!employee || !employee.email || !employee.entitySlug) {
          // No match, no email on file, or an overseas employee classifyOverseasEmployee can't
          // place — any of these means "can't send an OTP", but the response stays generic (see
          // GENERIC_OTP_SENT_MESSAGE) except when we know exactly who they are but genuinely can't
          // reach them, which is worth telling them directly rather than a silent non-delivery.
          if (employee && (!employee.email || !employee.entitySlug)) {
            res.statusCode = 200;
            res.end(JSON.stringify({ ok: true, message: 'We could not determine where to send your code. Please contact HR.' }));
            return;
          }
          res.statusCode = 200;
          res.end(JSON.stringify({ ok: true, message: GENERIC_OTP_SENT_MESSAGE }));
          return;
        }
        if (!checkRateLimit(employee.code)) {
          res.statusCode = 429;
          res.end(JSON.stringify({ ok: false, error: 'Too many attempts. Please try again in a few minutes.' }));
          return;
        }
        const code = generateOtp();
        otpStore.set(employee.code, { code, employee, attempts: 0, expiresAt: Date.now() + OTP_TTL_MS });
        await sendOtpEmail(smtp, employee.email, employee.name, code);
        res.statusCode = 200;
        res.end(JSON.stringify({ ok: true, message: GENERIC_OTP_SENT_MESSAGE }));
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[employee-auth] request-otp failed', err);
        res.statusCode = 502;
        res.end(JSON.stringify({ ok: false, error: 'Could not send the verification email right now. Please try again shortly.' }));
      }
    });
  });

  server.middlewares.use('/api/employee-auth/verify-otp', (req, res) => {
    if (req.method !== 'POST') {
      res.statusCode = 405;
      res.end(JSON.stringify({ ok: false, error: 'Method not allowed' }));
      return;
    }
    readBody(req).then(async (body) => {
      res.setHeader('Content-Type', 'application/json');
      let identifier: string;
      let otp: string;
      try {
        const parsed = JSON.parse(body || '{}') as { identifier?: string; otp?: string };
        identifier = (parsed.identifier || '').trim();
        otp = (parsed.otp || '').trim();
      } catch {
        res.statusCode = 400;
        res.end(JSON.stringify({ ok: false, error: 'Invalid request' }));
        return;
      }
      if (!identifier || !otp) {
        res.statusCode = 400;
        res.end(JSON.stringify({ ok: false, error: 'Enter the verification code' }));
        return;
      }
      try {
        const employee = await resolveIdentifier(pmsCreds, identifier);
        if (!employee || !employee.entitySlug) {
          res.statusCode = 401;
          res.end(JSON.stringify({ ok: false, error: 'Incorrect or expired code' }));
          return;
        }
        const record = otpStore.get(employee.code);
        if (!record || record.expiresAt < Date.now()) {
          otpStore.delete(employee.code);
          res.statusCode = 401;
          res.end(JSON.stringify({ ok: false, error: 'Incorrect or expired code' }));
          return;
        }
        if (record.attempts >= MAX_VERIFY_ATTEMPTS) {
          otpStore.delete(employee.code);
          res.statusCode = 429;
          res.end(JSON.stringify({ ok: false, error: 'Too many incorrect attempts. Please request a new code.' }));
          return;
        }
        if (record.code !== otp) {
          record.attempts += 1;
          res.statusCode = 401;
          res.end(JSON.stringify({ ok: false, error: 'Incorrect or expired code' }));
          return;
        }
        otpStore.delete(employee.code);
        const token = randomBytes(24).toString('hex');
        registerSession(token, {
          role: 'employee',
          empCode: employee.code,
          entitySlug: employee.entitySlug,
          name: employee.name,
          email: employee.email,
        });
        res.statusCode = 200;
        res.end(JSON.stringify({
          ok: true,
          token,
          employee: { code: employee.code, name: employee.name, entitySlug: employee.entitySlug },
        }));
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[employee-auth] verify-otp failed', err);
        res.statusCode = 502;
        res.end(JSON.stringify({ ok: false, error: 'Verification failed. Please try again.' }));
      }
    });
  });
}

export function employeeAuthPlugin(pmsCreds: PmsCredentials, smtp: SmtpCredentials): Plugin {
  return {
    name: 'employee-auth',
    configureServer(server) {
      registerMiddleware(server, pmsCreds, smtp);
    },
    configurePreviewServer(server) {
      registerMiddleware(server, pmsCreds, smtp);
    },
  };
}
