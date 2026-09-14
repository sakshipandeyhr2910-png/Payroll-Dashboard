export interface KoenigEmployeeRaw {
  // The PMS bulk response itself never includes an Emp Code (confirmed live, even for the 15
  // known Rayontara employees) — this is recovered server-side by scanning the per-code endpoint
  // across the company's known code ranges and matching back by exact full name (see
  // vite-plugins/rayontaraApiPlugin.ts). null means no unambiguous match was found (name not in
  // the scanned range, or shared by more than one employee), not that the person has no code.
  code: number | null;
  first_name: string | null;
  middle_name: string | null;
  last_name: string | null;
  city_name: string | null;
  country_name: string | null;
  state_name: string | null;
  address_details: string | null;
  address_pin_code: string | null;
  email_address: string | null;
  manager_name: string | null;
  deparment_name: string | null;
  designation_name: string | null;
  date_of_joining: string | null;
  official_phone_number: string | null;
  personal_phone_number: string | null;
  bank_account: string | null;
  bank_name: string | null;
  ifsc_code: string | null;
  present_address: string | null;
  date_of_resigantion: string | null;
  last_working_day: string | null;
  UAN: string | null;
  Is_oversease: string | null;
  Is_rayontara: string | null;
  // Confirmed live: unlike the Is_* flags (all strings), this comes through as a raw JSON number.
  working_days: string | number | null;
  Is_blue_collared_job: string | null;
}

export type KoenigLiveResult =
  | { ok: true; employees: KoenigEmployeeRaw[]; matched: number; total: number }
  | { ok: false; error: string };

// Calls the local Vite plugin middleware (vite-plugins/rayontaraApiPlugin.ts) — the same PMS
// credentials/token cache as Rayontara, just a different endpoint that bulk-fetches every
// employee and filters to Is_rayontara=false / Is_oversease=false. The browser never sees the
// PMS credentials.
//
// forceRefresh (?refresh=true) tells the server to also throw away its cached code-matching scan
// (getCodeUniverse — see rayontaraApiPlugin.ts), not just re-fetch the employee list. That scan
// is cached for the server's entire lifetime because it's ~10k API calls; a code that couldn't be
// matched during the one-time scan (a transient miss on the PMS side, or a record that only
// became queryable there afterwards) otherwise stays permanently unmatched no matter how many
// times "Update Employee List" is clicked — plain re-fetching without this flag would just get
// the same stale answer back. Only the explicit "Update Employee List" button passes true; the
// normal page-load path leaves the cache alone, since redoing a 10k-call scan on every visit
// would be needlessly slow.
export async function fetchKoenigLiveEmployees(forceRefresh = false): Promise<KoenigLiveResult> {
  try {
    const res = await fetch(`/api/koenig/employees${forceRefresh ? '?refresh=true' : ''}`);
    const data = (await res.json()) as KoenigLiveResult;
    return data;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error reaching PMS API' };
  }
}
