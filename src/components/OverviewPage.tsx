import { useEffect, useState } from 'react';
import { ENTITIES } from '../data/entities';
import { entityCurrencies } from '../utils/currencies';
import { fetchKoenigLiveEmployees } from '../utils/koenigLiveApi';
import { fetchRayontaraLiveEmployees } from '../utils/rayontaraLiveApi';
import { fetchGlobalLiveEmployees } from '../utils/globalLiveApi';
import { fetchOverseasLiveEmployees } from '../utils/overseasLiveApi';
import { classifyOverseasEmployee, OVERSEAS_ENTITY_SLUGS } from '../utils/overseasEntityMapping';
import type { TabId } from '../App';

interface Props {
  onNavigate: (tab: TabId) => void;
}

// Koenig, Rayontara, Global and the 8 overseas country entities (Dubai, USA, UK, New Zealand,
// Australia, Malaysia, Saudi, Canada) are all backed by the live PMS API (see EntityPage.tsx) —
// their card counts here should match what actually renders in their Payroll Register rather
// than the static sample headcount in data/entities.ts. This fetches independently of
// EntityPage's own fetch, but hits the same server-side plugin cache (vite-plugins/
// rayontaraApiPlugin.ts), so it's fast except for a genuine first load of the process. The 8
// overseas entities share ONE fetch (same as EntityPage.tsx) — classifyOverseasEmployee splits it
// into a per-entity count, same routing rules used for the Payroll Register itself.
export default function OverviewPage({ onNavigate }: Props) {
  const [liveCounts, setLiveCounts] = useState<Partial<Record<string, number>>>({});

  useEffect(() => {
    let cancelled = false;
    fetchKoenigLiveEmployees().then((result) => {
      if (cancelled || !result.ok) return;
      setLiveCounts((prev) => ({ ...prev, koenig: result.employees.length }));
    });
    fetchRayontaraLiveEmployees().then((result) => {
      if (cancelled || !result.ok) return;
      setLiveCounts((prev) => ({ ...prev, rayontara: result.employees.length }));
    });
    fetchGlobalLiveEmployees().then((result) => {
      if (cancelled || !result.ok) return;
      setLiveCounts((prev) => ({ ...prev, global: result.employees.length }));
    });
    fetchOverseasLiveEmployees().then((result) => {
      if (cancelled || !result.ok) return;
      const perEntity: Partial<Record<string, number>> = {};
      for (const slug of OVERSEAS_ENTITY_SLUGS) perEntity[slug] = 0;
      for (const e of result.employees) {
        const slug = classifyOverseasEmployee(e);
        if (slug) perEntity[slug] = (perEntity[slug] ?? 0) + 1;
      }
      setLiveCounts((prev) => ({ ...prev, ...perEntity }));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Every other entity's headcount in data/entities.ts is illustrative sample data, not a real
  // count — showing it alongside genuinely live numbers would misleadingly imply it's just as
  // real, so it reads 0 here instead (while the live entities briefly still fall back to their
  // sample figure only until their own fetch resolves, to avoid a flash of 0 before the real count
  // arrives).
  const LIVE_ENTITY_SLUGS = new Set(['koenig', 'rayontara', 'global', ...OVERSEAS_ENTITY_SLUGS]);
  const countFor = (slug: string, fallback: number) => {
    if (liveCounts[slug] !== undefined) return liveCounts[slug]!;
    return LIVE_ENTITY_SLUGS.has(slug) ? fallback : 0;
  };
  const totalEmployees = ENTITIES.reduce((sum, e) => sum + countFor(e.slug, e.headcount), 0);

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Payroll Dashboard</h1>
          <p className="page-desc">
            Automated Payroll Processing Engine — net payable salary computed monthly, per entity, in local
            currency. Entity cards below show live headcounts from the PMS API once each finishes loading.
          </p>
        </div>
        <div className="pillbar">
          <button className="pill-btn">Auto-run: 1st working day, 00:00 hrs</button>
          <button className="pill-btn green" onClick={() => window.print()}>Export Summary</button>
        </div>
      </div>
      <hr className="hr-divider" />

      <div className="stat-hero-row">
        <div className="stat-hero">
          <div className="num">{totalEmployees.toLocaleString()}</div>
          <div className="lbl">Total Employees</div>
        </div>
        <div className="stat-hero">
          <div className="num">{ENTITIES.length}</div>
          <div className="lbl">Payroll Entities</div>
        </div>
      </div>

      <div className="section-label">Browse by entity</div>
      <div className="entity-grid">
        {ENTITIES.map((e) => {
          const isLive = liveCounts[e.slug] !== undefined;
          return (
            <div className="entity-card" key={e.slug} onClick={() => onNavigate(e.slug)}>
              <div className="ename">
                {e.name}
                {isLive && <span className="src-badge live">Live</span>}
              </div>
              <div className="emeta">
                <span>{countFor(e.slug, e.headcount).toLocaleString()} employees</span>
                <span className="ecur">{entityCurrencies(e.slug, e.currency).join(' / ')}</span>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
