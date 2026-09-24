import { kv } from './kv.js';
import type { ResolvedEmployee } from './employeeLookup.js';

// Production equivalent of vite-plugins/employeeAuthPlugin.ts's in-memory otpStore/rateLimits
// Maps — same shape, backed by Turso so it survives across serverless invocations. Keyed by
// resolved Emp Code (not the raw identifier an employee typed), so requesting by ID one time and
// by email the next still hits the same slot for the same person.
interface OtpRecord {
  code: string;
  employee: ResolvedEmployee;
  attempts: number;
}

const OTP_TTL_SECONDS = 5 * 60;
const MAX_VERIFY_ATTEMPTS = 5;
const RATE_LIMIT_WINDOW_SECONDS = 15 * 60;
const RATE_LIMIT_MAX = 5;

function otpKey(empCode: number): string {
  return `otp:${empCode}`;
}

function rateLimitKey(empCode: number): string {
  return `otp-rl:${empCode}`;
}

// Not perfectly atomic (a get-then-set, same caveat api/_lib/kv.ts's own comments note elsewhere
// for non-nx writes) — an OTP request is a low-frequency, human-paced action, so a rare double
// count under concurrent requests from the same person is a non-issue next to the complexity of
// making it fully atomic.
export async function checkAndBumpRateLimit(empCode: number): Promise<boolean> {
  const key = rateLimitKey(empCode);
  const current = await kv.get<number>(key);
  if (current === null) {
    await kv.set(key, 1, { ex: RATE_LIMIT_WINDOW_SECONDS });
    return true;
  }
  if (current >= RATE_LIMIT_MAX) return false;
  await kv.set(key, current + 1, { ex: RATE_LIMIT_WINDOW_SECONDS });
  return true;
}

export async function storeOtp(employee: ResolvedEmployee, code: string): Promise<void> {
  const record: OtpRecord = { code, employee, attempts: 0 };
  await kv.set(otpKey(employee.code), record, { ex: OTP_TTL_SECONDS });
}

export type VerifyOtpResult =
  | { ok: true; employee: ResolvedEmployee }
  | { ok: false; error: string };

export async function verifyOtp(empCode: number, submitted: string): Promise<VerifyOtpResult> {
  const key = otpKey(empCode);
  const record = await kv.get<OtpRecord>(key);
  if (!record) return { ok: false, error: 'Incorrect or expired code' };
  if (record.attempts >= MAX_VERIFY_ATTEMPTS) {
    await kv.del(key);
    return { ok: false, error: 'Too many incorrect attempts. Please request a new code.' };
  }
  if (record.code !== submitted) {
    await kv.set(key, { ...record, attempts: record.attempts + 1 }, { ex: OTP_TTL_SECONDS });
    return { ok: false, error: 'Incorrect or expired code' };
  }
  await kv.del(key); // single-use — a verified code can never be replayed
  return { ok: true, employee: record.employee };
}
