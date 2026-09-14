// Standalone out-of-band script — NOT part of the Vercel deployment (nothing under api/ imports
// it). Run it locally (`npm run warm-code-universe`) or on a schedule via
// .github/workflows/warm-koenig-cache.yml.
//
// This ports the ~10,000-call employee-code recovery scan that used to live inline in
// vite-plugins/rayontaraApiPlugin.ts (scanCodeUniverse/scanCodesOnce/getCodeUniverse), cached
// in-memory "for the life of the server process" there. A Vercel serverless function has no such
// process to cache it in, and can't run a 10k-call scan within the Hobby plan's 10-second limit
// anyway — so this script does the scan on its own schedule and writes the result to KV, where
// api/koenig/employees.ts and api/global/employees.ts read it from (see
// api/_lib/codeUniverseMatch.ts for the read side and the JSON-safe SerializedCodeUniverse shape).
//
// Requires the same PMS_* env vars as the live PMS employee handlers, plus KV_REST_API_URL /
// KV_REST_API_TOKEN (read by @vercel/kv the same way it would be inside a Vercel function — see
// api/_lib/kv.ts). When run from GitHub Actions these all come from repo secrets (see
// .github/workflows/warm-koenig-cache.yml); when run locally, from your `.env` (loaded below via
// a plain `dotenv`-style parse, since this script runs outside Vite's `loadEnv`).

import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { kv } from '../api/_lib/kv';
import {
  fetchEmployeeByCode,
  fetchToken,
  normalizeDoj,
  normalizeName,
  type PmsCredentials,
  type PmsEmployee,
  type TokenState,
} from '../api/_lib/pmsClient';
import type { SerializedCodeUniverse } from '../api/_lib/codeUniverseMatch';

// Minimal .env loader (no dependency added just for this) — only used when this script runs
// locally; GitHub Actions passes env vars in directly, and dotenv-style files don't exist there.
function loadDotEnvIfPresent(): void {
  const envPath = path.resolve(process.cwd(), '.env');
  if (!existsSync(envPath)) return;
  const lines = readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

// Same bounds as the original: live probing found the whole company's codes cluster densely in
// two bands (roughly 1-4,850 and 10,000-10,070; empty everywhere else tested up to 30,000).
const KOENIG_CODE_SCAN_MIN = 1;
const KOENIG_CODE_SCAN_MAX = 10100;
const KOENIG_CODE_SCAN_CONCURRENCY = 25;
const CODE_SCAN_MAX_RETRY_PASSES = 2;

interface CodeUniverse {
  nameToCodes: Map<string, number[]>;
  nameDojToCodes: Map<string, number[]>;
  codeDetails: Map<number, PmsEmployee>;
}

function addTo(map: Map<string, number[]>, key: string, code: number) {
  const existing = map.get(key);
  if (existing) existing.push(code);
  else map.set(key, [code]);
}

async function scanCodesOnce(
  creds: PmsCredentials,
  token: TokenState,
  codes: number[],
  nameToCodes: Map<string, number[]>,
  nameDojToCodes: Map<string, number[]>,
  codeDetails: Map<number, PmsEmployee>,
): Promise<number[]> {
  const errored: number[] = [];
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < codes.length) {
      const code = codes[nextIndex++];
      try {
        const employee = await fetchEmployeeByCode(creds, token, code);
        if (!employee) continue;
        const key = normalizeName(employee);
        if (!key) continue;
        addTo(nameToCodes, key, code);
        addTo(nameDojToCodes, `${key}|${normalizeDoj(employee.date_of_joining)}`, code);
        codeDetails.set(code, employee);
      } catch {
        errored.push(code);
      }
    }
  }

  await Promise.all(Array.from({ length: KOENIG_CODE_SCAN_CONCURRENCY }, worker));
  return errored;
}

async function scanCodeUniverse(creds: PmsCredentials, token: TokenState): Promise<CodeUniverse> {
  const nameToCodes = new Map<string, number[]>();
  const nameDojToCodes = new Map<string, number[]>();
  const codeDetails = new Map<number, PmsEmployee>();
  const allCodes: number[] = [];
  for (let c = KOENIG_CODE_SCAN_MIN; c <= KOENIG_CODE_SCAN_MAX; c++) allCodes.push(c);

  let pending = allCodes;
  let pass = 0;
  let firstPassFailureCount = 0;
  while (pending.length > 0 && pass <= CODE_SCAN_MAX_RETRY_PASSES) {
    console.log(`Scan pass ${pass + 1}: ${pending.length} codes remaining...`);
    const errored = await scanCodesOnce(creds, token, pending, nameToCodes, nameDojToCodes, codeDetails);
    if (pass === 0) firstPassFailureCount = errored.length;
    pending = errored;
    pass++;
  }

  if (firstPassFailureCount > allCodes.length * 0.2) {
    throw new Error(`Code scan aborted: ${firstPassFailureCount}/${allCodes.length} lookups failed on first pass`);
  }
  return { nameToCodes, nameDojToCodes, codeDetails };
}

function serialize(universe: CodeUniverse): SerializedCodeUniverse {
  const nameToCodes: Record<string, number[]> = {};
  for (const [k, v] of universe.nameToCodes) nameToCodes[k] = v;
  const nameDojToCodes: Record<string, number[]> = {};
  for (const [k, v] of universe.nameDojToCodes) nameDojToCodes[k] = v;
  const codeDetails: Record<string, PmsEmployee> = {};
  for (const [k, v] of universe.codeDetails) codeDetails[String(k)] = v;
  return { nameToCodes, nameDojToCodes, codeDetails };
}

async function main() {
  loadDotEnvIfPresent();

  const creds: PmsCredentials = {
    base: requireEnv('PMS_API_BASE'),
    username: requireEnv('PMS_USERNAME'),
    password: requireEnv('PMS_PASSWORD'),
    role: requireEnv('PMS_ROLE'),
    apiKey: requireEnv('PMS_API_KEY'),
  };
  requireEnv('KV_REST_API_URL');
  requireEnv('KV_REST_API_TOKEN');

  console.log('Fetching PMS token...');
  let token = await fetchToken(creds);

  console.log(`Scanning code universe (codes ${KOENIG_CODE_SCAN_MIN}-${KOENIG_CODE_SCAN_MAX}, ~${KOENIG_CODE_SCAN_MAX - KOENIG_CODE_SCAN_MIN + 1} calls)...`);
  let universe: CodeUniverse;
  try {
    universe = await scanCodeUniverse(creds, token);
  } catch (err) {
    console.warn('First scan attempt failed — refreshing token and retrying once:', err);
    token = await fetchToken(creds);
    universe = await scanCodeUniverse(creds, token);
  }

  const serialized = serialize(universe);
  const codeCount = Object.keys(serialized.codeDetails).length;
  console.log(`Scan complete: ${codeCount} codes matched to a name. Writing to KV...`);

  // Written to both keys — see api/_lib/codeUniverseMatch.ts's SerializedCodeUniverse comment:
  // Koenig and Global currently share one underlying scan (the matching logic just filters which
  // employees to apply it to), but each entity page reads its own KV key so they can diverge
  // later without a script/schema change.
  await kv.set('codeUniverse:koenig', serialized);
  await kv.set('codeUniverse:global', serialized);

  console.log('Done.');
}

main().catch((err) => {
  console.error('warmCodeUniverse failed:', err);
  process.exitCode = 1;
});
