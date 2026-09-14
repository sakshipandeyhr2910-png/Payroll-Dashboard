import { useCallback, useState } from 'react';
import Sidebar from './components/Sidebar';
import Topbar from './components/Topbar';
import OverviewPage from './components/OverviewPage';
import EntityPage from './components/EntityPage';
import { ENTITIES, bySlug } from './data/entities';
import { BASE_MONTH } from './utils/month';
import type { CategoryFilter } from './types';
import type { CurrencyFilterValue } from './components/CurrencyChips';

export type TabId = 'overview' | string;

interface Props {
  onLogout: () => void;
}

export default function App({ onLogout }: Props) {
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('All');
  const [currencyFilter, setCurrencyFilter] = useState<CurrencyFilterValue>('All');
  const [selectedMonth, setSelectedMonth] = useState<string>(BASE_MONTH);

  const navigate = useCallback((tab: TabId) => {
    setActiveTab((prevTab) => {
      if (tab !== 'overview' && tab !== prevTab) {
        setCategoryFilter('All');
        setCurrencyFilter('All');
      }
      return tab;
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const handleSearchSubmit = useCallback((value: string) => {
    const val = value.trim().toLowerCase();
    if (!val) return;
    const match = ENTITIES.find(
      (ent) => ent.name.toLowerCase().includes(val) || ent.full.toLowerCase().includes(val),
    );
    if (match) navigate(match.slug);
  }, [navigate]);

  const activeEntity = activeTab !== 'overview' ? bySlug[activeTab] : undefined;

  return (
    <div className="app">
      <Sidebar activeTab={activeTab} onNavigate={navigate} />
      <div className="main">
        <Topbar onSearchSubmit={handleSearchSubmit} onLogout={onLogout} />
        <div className="content">
          <section className={`page${activeTab === 'overview' ? ' active' : ''}`}>
            <OverviewPage onNavigate={navigate} />
          </section>

          <section className={`page${activeEntity ? ' active' : ''}`}>
            {activeEntity && (
              <EntityPage
                entity={activeEntity}
                categoryFilter={categoryFilter}
                onCategoryFilterChange={setCategoryFilter}
                currencyFilter={currencyFilter}
                onCurrencyFilterChange={setCurrencyFilter}
                selectedMonth={selectedMonth}
                onSelectedMonthChange={setSelectedMonth}
              />
            )}
          </section>

          <div className="footer-note">
            Payroll Dashboard · Koenig Solutions · Source: Payroll Algorithm Document 20.07.2026 · Prepared for Sakshi Pandey
          </div>
        </div>
      </div>
    </div>
  );
}
