import { fetchToken, fetchEmployeeByCode, toBool, type PmsCredentials, type PmsEmployee } from './pmsClient.js';
import { classifyOverseasEmployee } from './overseasEntityMapping.js';
import { RAYONTARA_EMP_CODES } from './rayontaraEmpCodes.js';
import { kv } from './kv.js';
import type { SerializedCodeUniverse } from './codeUniverseMatch.js';

// Employee Login identity model: "Employee ID" is the PMS Emp Code (the same number every other
// integration in this app keys off), and "registered email" is the PMS record's own email_address
// (@koenig-solutions.com per every record inspected). Both resolve to the same ResolvedEmployee
// shape — who they are, which dashboard entity their payroll data lives under, and where to email
// the OTP.
export interface ResolvedEmployee {
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

// codeUniverse:koenig / codeUniverse:global / codeUniverse:overseas are three keys holding the
// SAME company-wide scan (see scripts/warmCodeUniverse.ts) — one full code->employee directory,
// not a per-entity subset. Its codeDetails covers every scanned code, so this doubles as an email
// index for the whole company without any extra API calls: read the (already-cached) blob once and
// scan it in memory.
async function resolveByEmail(email: string): Promise<ResolvedEmployee | null> {
  const universe = await kv.get<SerializedCodeUniverse>('codeUniverse:koenig');
  if (!universe) return null;
  const target = email.trim().toLowerCase();
  for (const record of Object.values(universe.codeDetails)) {
    if (record.email_address && record.email_address.trim().toLowerCase() === target) {
      return toResolved(record);
    }
  }
  return null;
}

export async function resolveIdentifier(creds: PmsCredentials, identifier: string): Promise<ResolvedEmployee | null> {
  const trimmed = identifier.trim();
  if (/^\d+$/.test(trimmed)) return resolveByCode(creds, Number(trimmed));
  if (trimmed.includes('@')) return resolveByEmail(trimmed);
  return null;
}
