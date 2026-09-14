# Bug Report: Loan Advance Details API returns 500 error on every request

## Summary
The "Loan Advance Details" service on `api.koenig-solutions.com` fails on every call with a SQL Server error indicating a missing database table (`Mst_Loan`). No request variation succeeds — the endpoint has never returned employee loan/advance data.

## Severity
High — this API is fully non-functional. Any consuming system (including the Payroll Dashboard) cannot retrieve loan/advance deduction data at all.

## Environment
- **Base URL:** `https://api.koenig-solutions.com`
- **Affected endpoint:** `POST /api/Kites/Operator/common?apikey=337&accessToken=...&deviceToken=...`
- **Service / api_key:** `337` — "Loan Advance Details"
- **Auth role used:** `Loan Advance Details` (via `Sakshi_LoanAdvanceDeta`)

## Steps to Reproduce
1. Obtain a token:
   ```
   POST /api/Kites/Operator/GetToken
   {
     "userName": "Sakshi_LoanAdvanceDeta",
     "userPassword": "<see credential store>",
     "userRole": "Loan Advance Details"
   }
   ```
   → Succeeds, returns valid `accessToken` / `deviceToken`.

2. Call the Loan Advance data endpoint with the documented request shape:
   ```
   POST /api/Kites/Operator/common?apikey=337&accessToken={token}&deviceToken={device}
   {
     "EmpId": "",
     "FromDate": "",
     "ToDate": ""
   }
   ```

## Expected Result
```json
{
  "statuscode": 200,
  "message": "OK",
  "content": "[...loan/advance records...]"
}
```

## Actual Result
```json
{
  "statuscode": 500,
  "message": "Internal Server Error: Invalid object name 'Mst_Loan'.",
  "content": null
}
```

## Root Cause
`Invalid object name 'Mst_Loan'` is a SQL Server compile-time error meaning the table `Mst_Loan` does not exist in the database this service queries. The stored procedure/query behind api_key 337 references a table that has been renamed, dropped, or never created in this environment.

## Evidence This Is Server-Side, Not a Request-Format Issue
Tested extensively to rule out any client-side cause — every variation below produces the **identical** error:
- Blank request body (`EmpId/FromDate/ToDate` all `""`) — the documented shape
- A specific, valid `EmpId` (both a known Rayontara code and a known Koenig code)
- `GET` instead of `POST` → correctly rejected with `405 Method Not Allowed` (proves the endpoint does distinguish valid/invalid requests)
- Different field-name casings (`empId`, `EmpCode` instead of `EmpId`)
- Non-blank `FromDate`/`ToDate` in multiple date formats — one variant (`dd/mm/yyyy`) produced a *different* error (`Error converting data type nvarchar to date`), proving the server actively parses input and this isn't a generic catch-all failure
- 5 consecutive retries over 15 seconds — identical error every time (not intermittent)
- Adjacent `apikey` values (336, 338, 339) all return valid `200 OK` responses with real (unrelated) data, confirming `337` is correctly routed but its own backing query is broken

## Suggested Fix
Restore or recreate the `Mst_Loan` table, or update the stored procedure behind api_key 337 to reference wherever loan/advance data currently lives.

## Impact
Any consuming application cannot display Loan Amount / advance deduction data. Currently the Payroll Dashboard shows `₹0` for all employees with an honest error banner rather than fabricated figures, pending this fix.

## Verification Once Fixed
Re-run Step 2 above with a known `EmpId` that has an advance on file — should return `statuscode: 200` with a non-null `content` array containing `Employee Code`, `Advance Amount`, and `Date Advance Given` fields.
