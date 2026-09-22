// Duplicated from src/utils/overseasEntityMapping.ts (identical content) — api/_lib/ never
// imports from src/ (kept fully independent of the frontend build, same convention every other
// api/_lib/ file already follows). Keep both copies in sync if the routing rules ever change.
//
// Routes an overseas employee (Is_oversease=true from the PMS API) to the correct
// country-specific dashboard entity, per two explicit rules:
//
// Rule 1 — FZLLC tag always wins: an employee whose entity/tag is "FZLLC" is shown under Dubai
// regardless of any other field (their Payroll Processing Location is ignored entirely).
// golabl_type is the PMS field this tag lives in. Confirmed against a live pull of all 575
// employees: nobody currently has "FZLLC" (or anything else) in this field — it's either null or
// the literal string "false" for every one of them — so this rule matches nobody today. It's
// still implemented exactly as specified so it activates automatically the moment HR populates a
// real FZLLC value, rather than needing a code change later.
//
// Rule 2 — everyone else, by city: for every other overseas employee, the city in their Payroll
// Processing Location determines the country, which determines the dashboard entity.
//
// Dubai fallback (confirmed against an explicit, authoritative list of Dubai Emp Codes): 5 of the
// 20 overseas employees have a BLANK Payroll Processing Location but city_name="Dubai" in their
// own PMS record — a data-entry gap in the processing-location field specifically, not a genuinely
// unknown location. These 5 are confirmed real Dubai employees, so a blank processing location
// falls back to city_name for Dubai/UAE cities specifically before giving up. This fallback is
// scoped to Dubai only — every other country's blank-location case (if any) still can't be routed
// anywhere and is deliberately left out of every country tab rather than guessed at, since only
// Dubai has this confirmed, authoritative override.
export type OverseasEntitySlug = 'dubai' | 'usa' | 'uk' | 'newzealand' | 'australia' | 'malaysia' | 'saudi' | 'canada';

export const OVERSEAS_ENTITY_SLUGS: readonly OverseasEntitySlug[] = [
  'dubai', 'usa', 'uk', 'newzealand', 'australia', 'malaysia', 'saudi', 'canada',
];

const UAE_CITIES = new Set(['dubai', 'abu dhabi', 'sharjah']);

export interface OverseasRoutableEmployee {
  golabl_type: string | null;
  payroll_processing_location: string | null;
  city_name: string | null;
}

// City → dashboard entity. Keys are lowercased/trimmed for matching (see resolveCity). Covers the
// cities seen live plus each country's other major cities, so a future new hire elsewhere in the
// same country still resolves without a code change. "kuala lampur" (misspelled, but confirmed
// live in the payroll_processing_location field itself) is kept alongside the correct spelling.
const CITY_TO_ENTITY: Record<string, OverseasEntitySlug> = {
  // Dubai / UAE
  'dubai': 'dubai',
  'abu dhabi': 'dubai',
  'sharjah': 'dubai',
  // USA
  'washington dc': 'usa',
  'california': 'usa',
  'new york': 'usa',
  'los angeles': 'usa',
  'chicago': 'usa',
  'san francisco': 'usa',
  'houston': 'usa',
  // UK
  'london': 'uk',
  'manchester': 'uk',
  'birmingham': 'uk',
  'edinburgh': 'uk',
  'glasgow': 'uk',
  // New Zealand
  'wellington': 'newzealand',
  'auckland': 'newzealand',
  'christchurch': 'newzealand',
  // Australia
  'canberra': 'australia',
  'sydney': 'australia',
  'melbourne': 'australia',
  'brisbane': 'australia',
  'perth': 'australia',
  'adelaide': 'australia',
  // Malaysia
  'kuala lumpur': 'malaysia',
  'kuala lampur': 'malaysia',
  'penang': 'malaysia',
  'johor bahru': 'malaysia',
  // Saudi Arabia
  'riyadh': 'saudi',
  'jeddah': 'saudi',
  'dammam': 'saudi',
  'mecca': 'saudi',
  'medina': 'saudi',
  // Canada
  'toronto': 'canada',
  'vancouver': 'canada',
  'montreal': 'canada',
  'ottawa': 'canada',
  'calgary': 'canada',
};

function normalizeCity(city: string): string {
  return city.trim().toLowerCase().replace(/\s+/g, ' ');
}

function isFzllc(golablType: string | null): boolean {
  return typeof golablType === 'string' && golablType.trim().toLowerCase() === 'fzllc';
}

// Returns the dashboard entity slug this employee belongs under, or null if no rule can place
// them (no FZLLC tag, no processing location, and no Dubai-fallback match) — callers should
// exclude a null result from every country tab rather than guessing.
export function classifyOverseasEmployee(e: OverseasRoutableEmployee): OverseasEntitySlug | null {
  if (isFzllc(e.golabl_type)) return 'dubai';
  const location = e.payroll_processing_location;
  if (location && location.trim()) {
    return CITY_TO_ENTITY[normalizeCity(location)] ?? null;
  }
  // Blank processing location — see the Dubai fallback comment above.
  if (e.city_name && UAE_CITIES.has(normalizeCity(e.city_name))) return 'dubai';
  return null;
}
