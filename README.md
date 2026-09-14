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
