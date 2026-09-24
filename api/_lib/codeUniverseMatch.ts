import type { PmsEmployee, PmsEmployeeRaw } from './pmsClient.js';
import { normalizeDoj, normalizeName } from './pmsClient.js';

// JSON-safe shape of the "code universe" written to KV by scripts/warmCodeUniverse.ts (keys
// `codeUniverse:koenig` / `codeUniverse:global`) and read here by api/koenig/employees.ts and
// api/global/employees.ts. Mirrors vite-plugins/rayontaraApiPlugin.ts's in-memory `CodeUniverse`
// (which used Map<string, number[]> / Map<number, PmsEmployee>), just with plain objects instead
// of Maps since Maps aren't JSON-serializable — object keys are always strings, so codeDetails is
// keyed by the code's string form.
export interface SerializedCodeUniverse {
  // Plain full-name match — works whenever a name is unique across every scanned code.
  nameToCodes: Record<string, number[]>;
  // name+DOJ composite match — resolves the common case where two *different* real employees
  // happen to share a name (verified live: e.g. 5 different people are all named "Gurpreet
  // Kaur"), since their joining dates essentially never coincide too. Only used to disambiguate
  // when the plain name isn't already unique.
  nameDojToCodes: Record<string, number[]>;
  // Full record per scanned code — lets an ambiguous name(+DOJ) match with more than one
  // candidate code be resolved by inspecting what's actually behind each code, rather than always
  // giving up (see resolveAmbiguous below). Keyed by code as a string (JSON object key).
  codeDetails: Record<string, PmsEmployee>;
}

// A record with no designation AND no department at all isn't a genuine second registration —
// confirmed live: several "duplicate" codes for an otherwise uniquely-identified employee turn
// out to have every field but the name blank (no designation, department, bank, IFSC, UAN,
// manager — literally nothing else on file). That's an empty stub, not a second real employee.
function isHollowStub(e: PmsEmployee): boolean {
  return e.designation_name === null && e.deparment_name === null;
}

// Narrows an ambiguous set of candidate codes (same name, and — when called from the DOJ branch
// below — same joining date too) down to one, using signals that distinguish a genuinely
// *different* second employee from noise around the *same* employee, rather than ever guessing
// between two equally-plausible different people:
//   1. Drop hollow stubs (see above) — confirmed live these are pure noise, never the "other"
//      real registration.
//   2. If exactly one candidate remains, it's not ambiguous anymore — that IS the wrong feed
//      splitting one real employee across multiple listings, or the true content behind an
//      accidental duplicate; there's nothing left to guess.
//   3. Otherwise, if candidates split into resigned vs. still-active (date_of_resigantion unset),
//      and exactly one is active — confirmed live this is a genuine resigned-then-rejoined case
//      (the old and new codes share the same bank account/UAN, just a different manager/
//      designation) — the active one is the current, correct code; the resigned one is a stale
//      past employment record under a different code, not this employee's current identity.
//   4. Any other shape (e.g. two active, non-stub candidates) is genuinely undecidable — two
//      different real people can share a name and DOJ (rare, but seen live) and guessing between
//      them risks attaching one person's bank/PF details to someone else, so this still returns
//      null rather than picking one.
function resolveAmbiguous(candidates: number[], universe: SerializedCodeUniverse): number | null {
  if (candidates.length === 1) return candidates[0];
  const withDetails = candidates
    .map((code) => ({ code, details: universe.codeDetails[String(code)] }))
    .filter((c): c is { code: number; details: PmsEmployee } => !!c.details);

  const nonStub = withDetails.filter((c) => !isHollowStub(c.details));
  if (nonStub.length === 1) return nonStub[0].code;
  const pool = nonStub.length > 0 ? nonStub : withDetails;

  const active = pool.filter((c) => !c.details.date_of_resigantion);
  if (active.length === 1) return active[0].code;

  return null;
}

// Try the composite name+DOJ key first (resolves same-name collisions between different people);
// fall back to plain name only when that alone is already unique. Either branch defers to
// resolveAmbiguous when more than one code matches, rather than immediately giving up.
export function matchEmployeeCode(e: PmsEmployeeRaw, universe: SerializedCodeUniverse): number | null {
  const key = normalizeName(e);
  if (!key) return null;
  // Once there's at least one DOJ-scoped candidate, resolution stays scoped to that set — never
  // falls through to the broader (DOJ-ignoring) name-only set, which could span genuinely
  // different people with different joining dates and let resolveAmbiguous pick among the wrong
  // pool entirely. The name-only fallback below is only for when DOJ-scoped matching finds
  // nothing at all (e.g. a formatting mismatch in how the DOJ string round-trips).
  const dojMatches = universe.nameDojToCodes[`${key}|${normalizeDoj(e.date_of_joining)}`];
  if (dojMatches && dojMatches.length > 0) return resolveAmbiguous(dojMatches, universe);
  const nameMatches = universe.nameToCodes[key];
  if (nameMatches && nameMatches.length > 0) return resolveAmbiguous(nameMatches, universe);
  return null;
}

// Confirmed live: the bulk "get all employees" endpoint (emp_code:"") can return a severely
// truncated record for a given employee — e.g. code 3301 came back from bulk with designation,
// department, manager, city, address, bank details AND date_of_resigantion/last_working_day all
// null, showing as a currently-active employee with no other details, while querying that same
// code individually (emp_code:"3301") returned her complete record, including that she resigned
// on 2024-11-04. The code-universe scan (scripts/warmCodeUniverse.ts) already queried every code
// individually to build codeDetails — reusing that per-code record here, once a bulk row is
// matched to a code, needs no extra PMS calls and fixes this at the source rather than only in
// whichever one field (resignation status, in this case) happened to get noticed missing.
export function withMatchedCode<T extends PmsEmployeeRaw>(
  e: T,
  universe: SerializedCodeUniverse,
): PmsEmployeeRaw & { code: number | null } {
  const code = matchEmployeeCode(e, universe);
  if (code !== null) {
    const details = universe.codeDetails[String(code)];
    if (details) return details;
  }
  return { ...e, code };
}
