export interface PmsEmployee {
  // Not part of the PMS response schema — attached server-side from the emp_code the record
  // was queried with (see vite-plugins/rayontaraApiPlugin.ts).
  code: number;
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

export type RayontaraApiResult =
  | { ok: true; employees: PmsEmployee[] }
  | { ok: false; error: string };

// Calls the local Vite plugin middleware (vite-plugins/rayontaraApiPlugin.ts), which holds the
// PMS credentials server-side and does the token exchange — the browser never sees them.
export async function fetchRayontaraLiveEmployees(): Promise<RayontaraApiResult> {
  try {
    const res = await fetch('/api/rayontara/employees');
    const data = (await res.json()) as RayontaraApiResult;
    return data;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error reaching PMS API' };
  }
}
