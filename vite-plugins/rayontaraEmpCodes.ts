// The known Rayontara employee codes. Originally just the 15 from the uploaded Salary Sheet;
// live company-wide scans (bulk employee list filtered to Is_rayontara=true, codes recovered by
// name+DOJ match against the full code universe) have twice found genuine Rayontara employees
// never added to this list:
//   - First pass — all Blue Collar, which is exactly why Blue Collar looked short: 3337 (Neha
//     Mangolia, Cook), 3338 (Pooja Rajput, Housekeeping), 3508 (Rajeev Kumar, Driver), 3585 (Rahul
//     Chaudhary, Driver), 3790 (Suresh Moriya, Gardener).
//   - Second pass — a newer batch of codes: 4904 (Sunil Thapa, Gardener), 4905 (Rajeev Kumar,
//     Gardener — a different person from 3508's Rajeev Kumar, distinct code+DOJ), 4906 (Kiran
//     Singh, Teacher), 4907 (Kundan ., Cook/Helper).
// Both Rayontara PMS integrations (employee-details, appraisal-data) query per-code rather than in
// bulk, because neither endpoint's response includes an employee-code field of its own — querying
// per known code and attaching the code we asked for is the only reliable way to identify which
// record belongs to which employee (see each plugin's own fetch-by-code comment). Because of that,
// this list still needs a manual update whenever a new employee joins Rayontara — it isn't
// auto-discovered.
export const RAYONTARA_EMP_CODES = [
  1104, 2267, 2578, 2596, 2953, 3052, 3060, 3110, 3195, 3333, 3331, 3483, 3441, 3393, 3641,
  3337, 3338, 3508, 3585, 3790,
  4904, 4905, 4906, 4907,
];
