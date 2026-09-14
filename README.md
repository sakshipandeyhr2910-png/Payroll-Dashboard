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

### 2. Connect a KV/Redis store

Open the project's **Storage** tab → **Create Database** (or **Marketplace** → a Redis provider) →
connect a Redis-compatible store to the project. This automatically populates the
`KV_REST_API_URL` and `KV_REST_API_TOKEN` environment variables that `api/_lib/kv.ts`
(`@vercel/kv`) reads — no manual env var entry needed for those two.

### 3. Set environment variables

In **Settings → Environment Variables**, set everything the old `.env` used to hold, plus one new
one:

- **`JWT_SECRET` — new, required.** A long random string used to sign session JWTs (see
  `api/_lib/auth.ts`). Generate one with e.g. `openssl rand -hex 32`. Treat it like a password —
  anyone with it can mint a valid session token.
- **`DASHBOARD_USERNAME` / `DASHBOARD_PASSWORD` — required.** The shared dashboard login, same as
  local dev.
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
  - `KITES_DECRYPT_PASSWORD`, `KITES_DECRYPT_SALT` — shared by the Appraisal and Arrear APIs to
    decrypt their encrypted Amount/Salary fields (see `api/_lib/koenigDecryption.ts`)

Ask a maintainer for the actual credential values — they're not committed anywhere in this repo.

### 4. Set up the `warm-koenig-cache` GitHub Action

The Koenig and Global entity pages resolve each employee's PMS Emp Code via a ~10,000-call scan
across the company's known code ranges (see `api/_lib/codeUniverseMatch.ts`). That scan is far too
slow to run inside a single serverless invocation (Hobby plan: 10-second max execution time), so it
runs out-of-band instead, via `scripts/warmCodeUniverse.ts` and the scheduled workflow at
`.github/workflows/warm-koenig-cache.yml`, which writes its result to the same KV store connected
in step 2.

1. In the GitHub repo's **Settings → Secrets and variables → Actions**, add these repo secrets:
   `PMS_API_BASE`, `PMS_USERNAME`, `PMS_PASSWORD`, `PMS_ROLE`, `PMS_API_KEY`, `KV_REST_API_URL`,
   `KV_REST_API_TOKEN` (the last two are the same values from step 2 — copy them from the Vercel
   project's Storage tab or its Environment Variables page).
2. **The workflow must be run at least once manually before the Koenig/Global pages will work in
   production** — go to the **Actions** tab → **Warm Koenig/Global employee code cache** →
   **Run workflow**. Until it's run once, `api/koenig/employees.ts` and `api/global/employees.ts`
   respond with a `503` (`{ok:false, error:'Employee code cache not yet warmed — run the
   warm-koenig-cache workflow'}`) rather than attempting the scan inline.
3. After that first manual run, it also runs automatically on the schedule in the workflow file
   (daily at 03:00 UTC by default) to pick up newly-joined employees — adjust the cron if the
   roster changes fast enough that a day-old cache becomes a problem.
