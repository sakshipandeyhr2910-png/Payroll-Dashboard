# Bug Report: `GetLastTwoAppraisals` API returns `Salary` encrypted, not usable

## Summary

The `GetLastTwoAppraisals` API (role: `GetLastTwoAppraisals`, api_key `355`) is needed to
populate the Payroll Dashboard's **Appraisal Arrear** column for Koenig and Rayontara. The
integration is blocked because the API's `Salary` field is returned as encrypted ciphertext
instead of a plain number, so the required calculation
(`Appraisal Arrear = (New Salary − Old Salary) × pending months`) cannot be performed.

## Steps to reproduce

1. Authenticate via `api/Kites/Operator/GetToken` with:
   - `userName`: `Sakshi_GetLastTwoAppra`
   - `userRole`: `GetLastTwoAppraisals`
2. Call `api/Kites/Operator/common?apikey=355&accessToken=...&deviceToken=...` with body
   `{"EmpId": "4"}`.

## Actual result

```json
[
  {
    "AppraisalDate": "2026-04-01T00:00:00",
    "NextAppraisalDate": "2027-04-01T00:00:00",
    "Salary": "D5UtJWT3BYI4N0nI1uQe1A==",
    "CreatedDate": "2026-06-12T12:16:05.323"
  },
  {
    "AppraisalDate": "2025-05-01T00:00:00",
    "NextAppraisalDate": "2026-05-01T00:00:00",
    "Salary": "D5UtJWT3BYI4N0nI1uQe1A==",
    "CreatedDate": "2025-06-05T12:46:05.033"
  }
]
```

`Salary` decodes (base64) to 16 bytes of high-entropy binary data — not a number, not readable
text in any encoding:

```
hex: 0f952d2564f70582383749c8d6e41ed4
```

This is consistent across every employee code tested (4, 58, 139, 1, 1104, 2267, 2188, 4865) —
`Salary` is never a plain figure.

## Evidence this is genuine encryption, not a formatting quirk

- Employee 4's two appraisal records show the **identical** ciphertext for `Salary` — consistent
  with their salary genuinely not changing between the two appraisal dates (a deterministic
  cipher/mode produces identical output for identical input).
- Employee 58's two records show **two different** ciphertexts — consistent with a real salary
  change between appraisals.
- A known-plaintext check was attempted: employee 4's current salary is already confirmed as
  ₹2,50,000 via the (already-integrated, working) `GetAppraisalData` API's plaintext `Amount`
  field. XOR-ing the expected plaintext against the ciphertext bytes found no repeating key
  pattern, ruling out a simple/weak cipher.
- Standard weak-key-reuse decryption attempts (AES-128/256, ECB and CBC-with-zero-IV, keyed from
  this API's own password/username/api_key and from other already-issued API passwords, each
  hashed with MD5/SHA-256 as candidate key material) were all tried and none produced valid
  output.

## Expected result

`Salary` should be returned as a plain numeric value (matching how `GetAppraisalData`'s `Amount`
field already works), or the response should include the encryption key/algorithm needed to
decrypt it.

## Impact

The Payroll Dashboard's **Appraisal Arrear** column cannot be populated for Koenig or Rayontara
until this is resolved. All the surrounding logic (Emp Code matching, detecting the gap between
`AppraisalDate` and `CreatedDate`, and showing the arrear only once in the correct processed
month) is already built and ready — only the salary figures themselves are blocked.

## Suggested fix

One of the following, whichever is fastest on Koenig's side:

1. Return `Salary` in plaintext, consistent with `GetAppraisalData`'s `Amount` field.
2. Provide the decryption key/IV/algorithm used to encrypt `Salary`, so the dashboard's
   server-side integration can decrypt it before use.
3. Confirm how this field is currently consumed elsewhere internally (if any existing tool
   already decrypts it, that tool's method/key resolves this immediately).
