// Standalone out-of-band script — NOT part of the Vercel deployment. Run on a daily schedule via
// .github/workflows/capture-payroll-snapshots.yml (same pattern as warmCodeUniverse.ts).
//
// This is Phase 2 of the "Payroll" archive card: the automatic month-end capture. Rather than
// re-implementing EntityPage.tsx's ~1,300 lines of live-data fetching/aggregation (11 entities,
// each with its own PMS/Appraisal/Loan/Meal/Recovery/TDS/Leave/WFH/Arrear sources and settle
// conditions) a second time in Node — a sure way for the two copies to quietly drift apart — this
// script drives a real headless browser against the deployed dashboard, logs in as HR, and simply
// visits each entity page. That is enough: EntityPage.tsx already freezes a completed month's live
// data into an immutable snapshot the first time any HR session views it (see its
// snapshotSaveAttempted effect) via first-write-wins POST /api/snapshot/:entity/:month. This script
// only supplies the visit, so production never depends on a human HR user happening to open every
// entity tab right after month-end for a snapshot to exist.
//
// Idempotent by design: isMonthCompleted (utils/month.ts) is true for last month on every single
// day of the new month, not just the 1st, and the server enforces first-write-wins — so running
// this daily (rather than trying to compute "the last working day" and firing exactly once) is both
// simpler and safer. The first run after a month rolls over does the real freeze; every run after
// that for the same month is a confirmed no-op. A missed/late run (Action outage, deploy freeze)
// self-heals on the next day's run instead of silently skipping a month.

import { chromium, type Page, type Response as PwResponse } from 'playwright';
import { existsSync, readFileSync } from 'fs';
import path from 'path';

function loadDotEnvIfPresent(): void {
  const envPath = path.resolve(process.cwd(), '.env');
  if (!existsSync(envPath)) return;
  const lines = readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

// Mirrors utils/month.ts's currentMonth()/stepMonth() exactly — duplicated rather than imported
// since this script runs standalone under tsx/Node, outside the Vite build, and these two
// functions are a handful of lines with no dependencies of their own.
function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function previousMonth(ym: string): string {
  let [y, m] = ym.split('-').map(Number);
  m -= 1;
  if (m < 1) { m = 12; y -= 1; }
  return `${y}-${String(m).padStart(2, '0')}`;
}

// Same 11 sidebar entries as data/entities.ts (slug + display name) — duplicated as plain data
// rather than imported, since entities.ts's Entity type pulls in ../types which drags in JSX-less
// but still React-project-shaped path aliases not worth wiring up for a Node script this small.
const ENTITIES: { slug: string; name: string }[] = [
  { slug: 'koenig', name: 'Koenig India' },
  { slug: 'rayontara', name: 'Rayontara' },
  { slug: 'dubai', name: 'Dubai' },
  { slug: 'global', name: 'Global' },
  { slug: 'usa', name: 'USA' },
  { slug: 'uk', name: 'UK' },
  { slug: 'newzealand', name: 'New Zealand' },
  { slug: 'australia', name: 'Australia' },
  { slug: 'malaysia', name: 'Malaysia' },
  { slug: 'saudi', name: 'Saudi' },
  { slug: 'canada', name: 'Canada' },
];

const FREEZE_CONFIRM_TIMEOUT_MS = 120_000;

// Resolves once this entity+month is confirmed durably on file — either the GET on page-load finds
// it already frozen (a previous day's run, or an HR user, got there first) or the freeze POST this
// visit triggers completes successfully. Never rejects on timeout; the caller logs and moves on, so
// one stuck/slow entity (e.g. a PMS sub-API down) can't block the other ten.
function waitForFreezeConfirmation(page: Page, slug: string, month: string): Promise<'already-frozen' | 'frozen-now' | 'timed-out'> {
  const snapshotPath = `/api/snapshot/${slug}/${month}`;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: 'already-frozen' | 'frozen-now' | 'timed-out') => {
      if (settled) return;
      settled = true;
      page.off('response', onResponse);
      resolve(result);
    };

    async function onResponse(response: PwResponse) {
      if (settled) return;
      const url = response.url();
      if (!url.includes(snapshotPath)) return;
      const method = response.request().method();
      try {
        const body = await response.json();
        if (method === 'GET' && body?.ok && body?.exists) {
          finish('already-frozen');
        } else if (method === 'POST' && body?.ok) {
          finish('frozen-now');
        }
      } catch {
        // Non-JSON or already-consumed body — ignore, another response may still satisfy us.
      }
    }

    page.on('response', onResponse);
    setTimeout(() => finish('timed-out'), FREEZE_CONFIRM_TIMEOUT_MS);
  });
}

async function main() {
  loadDotEnvIfPresent();

  const dashboardUrl = requireEnv('DASHBOARD_URL').replace(/\/$/, '');
  const username = requireEnv('DASHBOARD_USERNAME');
  const password = requireEnv('DASHBOARD_PASSWORD');

  const targetMonth = previousMonth(currentMonth());
  console.log(`Capturing payroll snapshots for ${targetMonth} across ${ENTITIES.length} entities...`);

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(dashboardUrl, { waitUntil: 'domcontentloaded' });

    await page.fill('#login-username', username);
    await page.fill('#login-password', password);
    // Scoped to text rather than .login-btn: the Employee Login card's submit button shares that
    // class (and type="submit") but reads "Send OTP" — only the HR card's button says "Sign in".
    await page.click('button:has-text("Sign in")');
    await page.waitForSelector('.sidebar', { timeout: 30_000 });

    let monthAligned = false;
    const results: Record<string, string> = {};

    for (const entity of ENTITIES) {
      // Attached before any navigation for this entity — a local/fast deployment can serve the GET
      // snapshot check before the next line's await returns, so a listener attached afterward can
      // miss it entirely (confirmed live: exactly this raced away 3 of 11 entities in testing).
      const confirmMonth = waitForFreezeConfirmation(page, entity.slug, targetMonth);

      await page.click(`a.navlink:has-text("${entity.name}")`);
      await page.waitForSelector('.month-control', { timeout: 30_000 });

      // The dashboard always lands on the real current month; step back to the month that just
      // completed exactly once, on whichever entity we happen to visit first — selectedMonth is
      // lifted to App.tsx and shared across every entity tab, so it stays put for the rest of this
      // run.
      if (!monthAligned) {
        await page.click('button[title="Previous month"]');
        monthAligned = true;
      }

      results[entity.slug] = await confirmMonth;
      console.log(`  ${entity.slug}: ${results[entity.slug]}`);
    }

    const failed = Object.entries(results).filter(([, r]) => r === 'timed-out');
    if (failed.length > 0) {
      console.warn(`${failed.length}/${ENTITIES.length} entities did not confirm within timeout: ${failed.map(([s]) => s).join(', ')}. A later daily run will retry them (freeze is idempotent).`);
    } else {
      console.log(`All ${ENTITIES.length} entities confirmed for ${targetMonth}.`);
    }
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error('capturePayrollSnapshots failed:', err);
  process.exitCode = 1;
});
