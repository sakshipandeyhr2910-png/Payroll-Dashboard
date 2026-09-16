export interface OverseasEmployeeRaw {
  // Recovered server-side the same way as Koenig/Global — see koenigLiveApi.ts's comment. null
  // means no unambiguous match was found, not that the person has no code.
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
  working_days: string | number | null;
  Is_blue_collared_job: string | null;
  // Entity-routing fields — see utils/overseasEntityMapping.ts for how these place an employee
  // under Dubai / USA / UK / New Zealand / Australia / Malaysia / Saudi / Canada.
  golabl_type: string | null;
  payroll_processing_location: string | null;
}

export type OverseasLiveResult =
  | { ok: true; employees: OverseasEmployeeRaw[]; matched: number; total: number }
  | { ok: false; error: string };

// Calls the local Vite plugin middleware (vite-plugins/rayontaraApiPlugin.ts) — the same PMS
// credentials/token cache as Koenig/Rayontara/Global, filtered to Is_oversease=true instead. One
// shared fetch backs all 8 country-specific entity tabs; each EntityPage view filters this same
// list down to its own entity via classifyOverseasEmployee. See koenigLiveApi.ts's comment for why
// forceRefresh also throws away the server's cached code-matching scan.
export async function fetchOverseasLiveEmployees(forceRefresh = false): Promise<OverseasLiveResult> {
  try {
    const res = await fetch(`/api/overseas/employees${forceRefresh ? '?refresh=true' : ''}`);
    const data = (await res.json()) as OverseasLiveResult;
    return data;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error reaching PMS API' };
  }
}
