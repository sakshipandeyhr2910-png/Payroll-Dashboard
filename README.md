# Payroll Dashboard — Koenig

A React + TypeScript + Vite replica of the Koenig Payroll Dashboard prototype. Entity/employee data ships
as static JSON bundled into the app, except for **Rayontara**, whose Payroll Register overlays live
employee-master data synced from Koenig's PMS API at request time (see below).

## Stack

- **React 18 + TypeScript** — component-based UI, typed data models (`src/types.ts`)
- **Vite** — dev server + production bundling, plus a small server-side plugin (`vite-plugins/rayontaraApiPlugin.ts`)
  that proxies the PMS API so credentials never reach the browser
- Plain CSS (`src/styles/index.css`), ported 1:1 from the original prototype's design system (same CSS custom properties, class names, and layout rules)

## Getting started

Requires [Node.js](https://nodejs.org) (LTS, v18+).

```bash
npm install
```

Copy `.env.example` to `.env` and fill in credentials:

```bash
cp .env.example .env
```

- **`DASHBOARD_USERNAME` / `DASHBOARD_PASSWORD` — required.** This is the single shared login for the
  app's own sign-in screen (see `vite-plugins/dashboardAuthPlugin.ts`); every `/api/*` route is gated
  behind it, so the dashboard won't work at all without these set.
- **Everything else is per-feature and optional.** Each block (`PMS_*`, `APPRAISAL_*`, `LOAN_*`,
  `MEAL_*`, `RECOVERY_*`, `TDS_*`, `LEAVE_*`, `ARREAR_*`, plus the shared `KITES_DECRYPT_*` pair used to
  decrypt the Appraisal/Arrear API responses) configures one live PMS integration on Rayontara's page.
  Leave a block blank and that piece of data falls back to static/sample values — every other entity,
  and Rayontara itself, still works without any of them.

Ask a maintainer for the actual credential values — they're not committed anywhere in this repo.

**Quote any value containing `#`, spaces, or parentheses** — dotenv-style parsers can otherwise treat
`#` as a comment marker and silently truncate the value.

```bash
npm run dev
```

Open the printed local URL (typically `http://localhost:5173`).

To type-check and produce a production build:

```bash
npm run build
npm run preview   # serve the production build locally (also proxies the PMS API)
```

## Project structure

```
vite-plugins/
  rayontaraApiPlugin.ts        Vite server middleware: PMS token exchange + employee fetch, credentials stay server-side
src/
  types.ts                     Shared TypeScript interfaces (Entity, PayrollRow, ...)
  App.tsx                      Top-level state: active tab, month, category/currency filter
  main.tsx                     React entry point
  data/
    entities.ts                The 11 payroll entities (headcounts, currency, notes)
    entityRows.ts               Wraps entityRows.json with types
    entityRows.json             Sample/live payroll register rows, keyed by entity slug
    entityXlsxBase64.ts          Wraps entityXlsxBase64.json with types
    entityXlsxBase64.json       Pre-baked per-entity .xlsx files (base64), used by "Export to Excel"
    payrollColumns.ts           Column definitions for the payroll register table
  components/
    Sidebar.tsx                 Left nav (Overview + entity list)
    Topbar.tsx                  Global search box + user chip
    OverviewPage.tsx            Landing page: totals + entity picker cards
    EntityPage.tsx               Per-entity page: KPIs, payroll register, notes; drives the Rayontara live sync
    PayrollTable.tsx             Frozen Emp Code/Name pane + horizontally-scrolling data pane
    MonthControl.tsx             Prev/next month stepper + month picker
    CategoryChips.tsx            All / White Collar / Blue Collar filter chips
    CurrencyChips.tsx            Currency filter chips (only rendered for entities with 2+ payout currencies)
  utils/
    format.ts                    Number formatting (fmt)
    month.ts                     Month label/step/diff + sample-data monthly scaling factor
    payrollMath.ts                Row-level deduction/addition totals
    xlsxExport.ts                 Decodes the base64 .xlsx blob and triggers a browser download
    currencies.ts                 Derives an entity's distinct payout currencies from its rows
    rayontaraLiveApi.ts            Frontend fetch call to the local /api/rayontara/employees endpoint
    mergeRayontaraLiveData.ts      Overlays live PMS fields onto Rayontara's static rows (UAN match, name-token fallback)
```

## Rayontara live PMS integration

Rayontara's Payroll Register overlays live data from Koenig's internal PMS "Get Employee Details" API
on top of the uploaded Salary Sheet:

- **What's live**: employee name, designation, bank name, bank account, IFSC, UAN, base location (city).
- **What stays static**: Basic, HRA, Allowance, Gross, all deductions, Commission, and Net Payable —
  the PMS API doesn't return salary figures, only HR master data.
- **Security**: the PMS username/password/API key live only in `.env` and are read by
  `vite-plugins/rayontaraApiPlugin.ts`, which runs entirely on the Vite dev/preview server (Node
  context). The browser only ever calls the local `/api/rayontara/employees` endpoint and receives
  the already-filtered Rayontara employee list — the credentials and the rest of the company's
  employee roster (the PMS API returns the *entire* company when queried) never leave the server.
- **Matching**: rows are joined to PMS records by UAN when both sides have one; otherwise by checking
  that the PMS record's first and last name both appear as whole words in the sheet's stored name
  (handles cases like PMS "Suhel Ahmed" vs. sheet "Suhel Ahmed Mazumder").
- **Failure handling**: if the PMS API is unreachable or returns an error, the register falls back to
  the last-known Salary Sheet data and shows a warning note — it never breaks the page.

## Authentication

Two separate login modes, both gated by a real signed session (JWT in production via
`api/_lib/auth.ts`; an in-memory session map in local dev via `vite-plugins/dashboardAuthPlugin.ts`)
— neither is a frontend-only check. Every `/api/*` route requires a valid session of the correct
role; an authenticated session of the wrong role gets a 403, not just a hidden UI element.

- **HR Admin** — the original single shared login (`DASHBOARD_USERNAME`/`DASHBOARD_PASSWORD`).
  Full access to every existing bulk/HR endpoint (all employees, bank details, every entity).
- **Employee Login** — self-service, no shared credential. An employee enters their **Employee ID**
  (PMS Emp Code) or **registered email**, receives a 6-digit OTP by email (5-minute expiry, 5
  incorrect-attempt limit, rate-limited to 5 requests per 15 minutes per employee — see
  `api/_lib/otpStore.ts` / `vite-plugins/employeeAuthPlugin.ts`), and on successful verification
  gets a session scoped to exactly their own Emp Code and entity. That scope is embedded in the
  signed session itself (`SessionClaims` in `api/_lib/auth.ts`) — `/api/employee/*` handlers read
  it from there, never from a client-supplied parameter, so there is no request an employee session
  can make to see anyone else's data or reach an HR-only endpoint. Identity resolution (ID/email →
  employee → dashboard entity) works across every live entity via `api/_lib/employeeLookup.ts`.
  Currently shows the employee's own PMS profile and Pay Scale — not yet the full per-entity Net
  Payable breakdown HR's bulk view computes (see `api/_lib/routes/employeePayroll.ts`'s own scope
  note).
  - Requires SMTP credentials for the mailbox that sends OTP emails (see "Deploying to Vercel"
    below, and `.env.example`'s `SMTP_*` block for local dev).

## Overseas employee routing

Dubai, USA, UK, New Zealand, Australia, Malaysia, Saudi and Canada all pull from one shared PMS
fetch — every employee flagged `Is_oversease=true` (a separate, non-overlapping population from
Global-DMCC's `Is_global=true` employees) — via `/api/overseas/employees`. Each entity page filters
that same list down to its own country using `src/utils/overseasEntityMapping.ts`:

- **Rule 1 — FZLLC tag wins outright**: an employee whose `golabl_type` field is `"FZLLC"` is
  always routed to Dubai, regardless of their Payroll Processing Location. As of writing, no live
  employee actually has this value (`golabl_type` is `null` or `"false"` for all 575 employees
  checked) — the rule is implemented and ready, it just hasn't been triggered by real data yet.
- **Rule 2 — everyone else, by city**: the city in `payroll_processing_location` is looked up
  against a per-country city table (e.g. Toronto/Vancouver → Canada, London/Manchester → UK) to
  find the matching entity. An employee with a blank Payroll Processing Location — even one whose
  `city_name` elsewhere in the record suggests Dubai — is deliberately left out of every country
  tab rather than guessed at, per explicit decision; only a filled-in Payroll Processing Location
  routes them anywhere.
- Employee-master fields (name, designation, DOJ, bank details, UAN, location) and Pay Scale are
  live for these 8 entities — Pay Scale reuses the same generic Appraisal API client
  (`fetchKoenigAppraisal`) already used by Koenig/Global, and Salary is derived from it via
  EntityPage.tsx's generic (not entity-scoped) Pay-Scale-driven computation. PF and ESI are
  deliberately NOT derived from that same Appraisal record for these entities, even though it
  carries an EPF figure — those are India-specific deductions that don't apply overseas (see
  `isAppraisalPfEntity` in EntityPage.tsx). There's no Loan/Meal/Recovery/TDS/Leave/WFH integration
  wired up for these entities, so those columns show "—".
- Emp Code recovery reuses the exact same company-wide code-registry scan as Koenig/Global (see
  above) — on Vercel this reads the `codeUniverse:overseas` KV key, populated by the same
  `warm-koenig-cache` GitHub Action.

## Feature parity with the original prototype

- Sidebar navigation between **Overview** and 11 entities (Koenig, Rayontara, Dubai, Global, USA, UK,
  New Zealand, Australia, Malaysia, Saudi, Canada)
- Overview: total employees / entities stat cards, "Auto-run" pill (static label), "Export Summary"
  (triggers `window.print()`)
- Entity page:
  - Live vs. Sample data source badge (Rayontara additionally distinguishes "synced from PMS API" vs.
    "from uploaded Salary Sheet" depending on live-sync status)
  - Currency pill (shows both currencies for entities like Global that pay in more than one), **Export
    to Excel** (downloads the entity's pre-baked `.xlsx`)
  - KPI cards: headcount, currency, active, resigned
  - Payroll Register: frozen Emp Code + Name columns, fully bifurcated columns matching the source
    Salary Sheet, month stepper (with the same illustrative month-over-month scaling for sample
    entities, and the "only period on file" note for the live entity), All/White/Blue category chips,
    and a currency filter for entities paying in more than one currency. Overtime/DA columns only show
    when Blue Collar rows are in view; WFH Reimbursement only shows for Global.
  - Entity-specific statutory/notes callout
- Global search box: Enter jumps to the first matching entity by name

This mirrors the original static prototype's behavior exactly, including its known limitations (e.g.
payroll rows are not click-expandable despite the register's helper text — that affordance was never
wired up in the source prototype either).

## Deploying to Vercel

In production the backend runs as Vercel serverless functions under `api/` instead of the Vite dev
middleware in `vite-plugins/` (that directory and `vite.config.ts` are untouched and still power
`npm run dev` locally — Vercel's build only ever runs `npm run build`, i.e. `tsc -b && vite build`,
which never touches `api/`). See `api/_lib/` for the shared auth/KV/token-cache helpers and
`vercel.json` for the build/rewrite config.

### 1. Import the repo

In the [Vercel dashboard](https://vercel.com/new), import this repository. Vercel auto-detects the
Vite framework preset; `vercel.json` at the repo root pins `buildCommand`, `outputDirectory`, and a
rewrite so client-side routing (`/entity/koenig`, etc.) still serves `index.html` for any path that
isn't under `/api/`.

### 2. Create a Turso database

`api/_lib/kv.ts` stores everything shared across serverless invocations (session revocation,
cached Kites API tokens, the employee-code-universe cache, and frozen month-end Payroll Register
snapshots) in [Turso](https://turso.tech) (libSQL) rather than Vercel KV/Redis. Create a database
(via the Turso CLI or dashboard), then grab its URL and an auth token:

```bash
turso db create payroll-database
turso db show payroll-database --url
turso db tokens create payroll-database
```

You'll set these as `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` in the next step — no schema setup
needed, `api/_lib/kv.ts` creates its one table itself on first use.

### 3. Set environment variables

In **Settings → Environment Variables**, set everything the old `.env` used to hold, plus one new
one:

- **`JWT_SECRET` — new, required.** A long random string used to sign session JWTs (see
  `api/_lib/auth.ts`). Generate one with e.g. `openssl rand -hex 32`. Treat it like a password —
  anyone with it can mint a valid session token.
- **`DASHBOARD_USERNAME` / `DASHBOARD_PASSWORD` — required.** The shared dashboard login, same as
  local dev.
- **`TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` — required.** From step 2.
- **`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` — required for Employee
  Login.** A dedicated shared mailbox (not any one employee's own inbox) that sends OTP emails —
  see `api/_lib/mailer.ts`. Without these, `/api/employee-auth/request-otp` returns an error
  instead of silently pretending to send anything.
- **Per-feature blocks (all optional — a blank block just falls back to static/sample data for
  that feature, same as local dev):**
  - `PMS_API_BASE`, `PMS_USERNAME`, `PMS_PASSWORD`, `PMS_ROLE`, `PMS_API_KEY`
  - `APPRAISAL_API_BASE`, `APPRAISAL_USERNAME`, `APPRAISAL_PASSWORD`, `APPRAISAL_ROLE`, `APPRAISAL_API_KEY`
  - `LOAN_API_BASE`, `LOAN_USERNAME`, `LOAN_PASSWORD`, `LOAN_ROLE`, `LOAN_API_KEY`
  - `MEAL_API_BASE`, `MEAL_USERNAME`, `MEAL_PASSWORD`, `MEAL_ROLE`, `MEAL_API_KEY`
  - `RECOVERY_API_BASE`, `RECOVERY_USERNAME`, `RECOVERY_PASSWORD`, `RECOVERY_ROLE`, `RECOVERY_API_KEY`
  - `TDS_API_BASE`, `TDS_USERNAME`, `TDS_PASSWORD`, `TDS_ROLE`, `TDS_API_KEY`
  - `LEAVE_API_BASE`, `LEAVE_USERNAME`, `LEAVE_PASSWORD`, `LEAVE_ROLE`, `LEAVE_API_KEY`
  - `ARREAR_API_BASE`, `ARREAR_USERNAME`, `ARREAR_PASSWORD`, `ARREAR_ROLE`, `ARREAR_API_KEY`
  - `WFH_API_BASE`, `WFH_USERNAME`, `WFH_PASSWORD`, `WFH_ROLE`, `WFH_API_KEY`
  - `KITES_DECRYPT_PASSWORD`, `KITES_DECRYPT_SALT` — shared by the Appraisal and Arrear APIs to
    decrypt their encrypted Amount/Salary fields (see `api/_lib/koenigDecryption.ts`)

Ask a maintainer for the actual credential values — they're not committed anywhere in this repo.

### 4. Set up the `warm-koenig-cache` GitHub Action

The Koenig and Global entity pages resolve each employee's PMS Emp Code via a ~10,000-call scan
across the company's known code ranges (see `api/_lib/codeUniverseMatch.ts`). That scan is far too
slow to run inside a single serverless invocation (Hobby plan: 10-second max execution time), so it
runs out-of-band instead, via `scripts/warmCodeUniverse.ts` and the scheduled workflow at
`.github/workflows/warm-koenig-cache.yml`, which writes its result to the same Turso database
created in step 2.

1. In the GitHub repo's **Settings → Secrets and variables → Actions**, add these repo secrets:
   `PMS_API_BASE`, `PMS_USERNAME`, `PMS_PASSWORD`, `PMS_ROLE`, `PMS_API_KEY`, `TURSO_DATABASE_URL`,
   `TURSO_AUTH_TOKEN` (the last two are the same values from step 2/3).
2. **The workflow must be run at least once manually before the Koenig/Global pages will work in
   production** — go to the **Actions** tab → **Warm Koenig/Global employee code cache** →
   **Run workflow**. Until it's run once, `api/koenig/employees.ts` and `api/global/employees.ts`
   respond with a `503` (`{ok:false, error:'Employee code cache not yet warmed — run the
   warm-koenig-cache workflow'}`) rather than attempting the scan inline.
3. After that first manual run, it also runs automatically on the schedule in the workflow file
   (daily at 03:00 UTC by default) to pick up newly-joined employees — adjust the cron if the
   roster changes fast enough that a day-old cache becomes a problem.

### 5. Set up the `capture-payroll-snapshots` GitHub Action

The "Payroll" card on each entity page lets HR download an immutable snapshot of any past month.
Those snapshots normally freeze themselves the moment any HR session views a completed month (see
`EntityPage.tsx`'s freeze effect) — but that depends on someone actually opening the dashboard
after month-end. `scripts/capturePayrollSnapshots.ts` and
`.github/workflows/capture-payroll-snapshots.yml` remove that dependency: the workflow logs into
the deployed dashboard as HR and visits every entity page itself, so the freeze happens
automatically every month regardless of whether a human does.

1. In the GitHub repo's **Settings → Secrets and variables → Actions**, add these repo secrets:
   `DASHBOARD_URL` (the deployed site, e.g. `https://payroll-dashboard.vercel.app`),
   `DASHBOARD_USERNAME`, `DASHBOARD_PASSWORD` (the same two from step 3).
2. That's it — no manual first run required. It runs daily at 00:05 IST; the first run after a
   month rolls over does the real freeze, every run after that for the same month confirms it's
   already frozen and does nothing (safe to also trigger manually via **Actions** →
   **Capture monthly payroll snapshots** → **Run workflow**).
