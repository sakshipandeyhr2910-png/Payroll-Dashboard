import { useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { TEXT_FALLBACK_COLS, type PayrollColumn } from '../data/payrollColumns';
import { fmt } from '../utils/format';
import type { PayrollRow } from '../types';

interface Props {
  rows: PayrollRow[];
  columns: PayrollColumn[];
  // Excel-style per-column filters are opt-in (Koenig/Rayontara only, per explicit request) —
  // every other entity renders exactly as before, with no icon and no filtering overhead.
  enableColumnFilters?: boolean;
}

// The two pinned columns (Emp Code, Employee Name) aren't in `columns` (see payrollColumns.ts's
// comment on why they render separately), so they get their own pseudo-keys here to share the
// same filter machinery as every other column.
type FilterKey = 'code' | 'name' | PayrollColumn['key'];

// Mirrors each cell's actual on-screen rendering exactly (see the two tbody.map() blocks below) —
// filtering has to match what the user is actually looking at, not the raw underlying value.
function displayValue(row: PayrollRow, key: FilterKey): string {
  if (key === 'code') return Number.isNaN(row.code) ? '—' : String(row.code);
  if (key === 'name') return row.name;
  if (key === 'remarks') return row.remarks || '';
  if (TEXT_FALLBACK_COLS.has(key as keyof PayrollRow)) {
    return (row[key as keyof PayrollRow] as string | undefined) || '—';
  }
  const value = row[key as keyof PayrollRow];
  if (value === undefined || value === null) return '—';
  return typeof value === 'string' ? value : fmt(value as number);
}

// Numeric-looking values (after stripping fmt()'s thousands separators) sort numerically;
// otherwise alphabetically. "—" (unknown) always sorts last, like a blank cell in a spreadsheet.
function sortValues(values: string[]): string[] {
  const dashes = values.filter((v) => v === '—');
  const rest = values.filter((v) => v !== '—');
  const asNumbers = rest.map((v) => Number(v.replace(/,/g, '')));
  const allNumeric = rest.length > 0 && asNumbers.every((n) => !Number.isNaN(n));
  const sortedRest = allNumeric
    ? rest.slice().sort((a, b) => Number(a.replace(/,/g, '')) - Number(b.replace(/,/g, '')))
    : rest.slice().sort((a, b) => a.localeCompare(b));
  return [...sortedRest, ...dashes];
}

interface OpenFilter {
  key: FilterKey;
  label: string;
  anchor: DOMRect;
}

export default function PayrollTable({ rows, columns, enableColumnFilters = false }: Props) {
  const dropdownRef = useRef<HTMLDivElement>(null);

  // filters[key] absent = no restriction (every value shown) for that column. Only ever holds a
  // *proper subset* of that column's values — selecting everything is the same as clearing the
  // filter, so it's normalized away on Apply rather than carried around as a no-op filter.
  const [filters, setFilters] = useState<Partial<Record<FilterKey, Set<string>>>>({});
  const [openFilter, setOpenFilter] = useState<OpenFilter | null>(null);
  const [pendingSelection, setPendingSelection] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');

  // Unique values per column come from the full incoming row set (already scoped by the
  // category/currency chips above the table) — not re-narrowed by whichever *other* column
  // filters happen to be active. Keeps every dropdown's option list stable and independent of
  // filtering order, at the cost of not being a fully cascading Excel filter.
  const valuesByKey = useMemo(() => {
    const map = new Map<FilterKey, string[]>();
    if (!enableColumnFilters) return map;
    const keys: FilterKey[] = ['code', 'name', ...columns.map((c) => c.key)];
    for (const key of keys) {
      const unique = new Set<string>();
      for (const row of rows) unique.add(displayValue(row, key));
      map.set(key, sortValues([...unique]));
    }
    return map;
  }, [rows, columns, enableColumnFilters]);

  const filteredRows = useMemo(() => {
    if (!enableColumnFilters || Object.keys(filters).length === 0) return rows;
    return rows.filter((row) =>
      (Object.entries(filters) as [FilterKey, Set<string>][]).every(([key, selected]) =>
        selected.has(displayValue(row, key)),
      ),
    );
  }, [rows, filters, enableColumnFilters]);

  function openFilterFor(key: FilterKey, label: string, el: HTMLElement) {
    const allValues = valuesByKey.get(key) || [];
    const current = filters[key] ?? new Set(allValues);
    setPendingSelection(new Set(current));
    setSearch('');
    setOpenFilter({ key, label, anchor: el.getBoundingClientRect() });
  }

  function applyOpenFilter() {
    if (!openFilter) return;
    const allValues = valuesByKey.get(openFilter.key) || [];
    setFilters((prev) => {
      const next = { ...prev };
      if (pendingSelection.size === allValues.length) {
        delete next[openFilter.key];
      } else {
        next[openFilter.key] = new Set(pendingSelection);
      }
      return next;
    });
    setOpenFilter(null);
  }

  function toggleValue(value: string) {
    setPendingSelection((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  }

  const visibleOptions = useMemo(() => {
    if (!openFilter) return [];
    const all = valuesByKey.get(openFilter.key) || [];
    if (!search.trim()) return all;
    const q = search.trim().toLowerCase();
    return all.filter((v) => v.toLowerCase().includes(q));
  }, [openFilter, valuesByKey, search]);

  function isFilterActive(key: FilterKey): boolean {
    return enableColumnFilters && filters[key] !== undefined;
  }

  function renderHeaderLabel(key: FilterKey, label: string) {
    if (!enableColumnFilters) return label;
    const isActive = isFilterActive(key);
    return (
      <span className="th-with-filter">
        <span>{label}</span>
        <button
          type="button"
          className={`col-filter-btn${isActive ? ' active' : ''}`}
          title={`Filter ${label}`}
          onClick={(e) => {
            e.stopPropagation();
            const alreadyOpenSameKey = openFilter?.key === key;
            if (alreadyOpenSameKey) {
              setOpenFilter(null);
            } else {
              openFilterFor(key, label, e.currentTarget);
            }
          }}
        >
          ▾
        </button>
      </span>
    );
  }

  return (
    <div className="payroll-outer">
      {/* A single table in a single scroll container — Emp Code/Employee Name are pinned via
          CSS position:sticky (not a second <table> kept in sync over JS scroll events). Two
          independent tables can never be guaranteed to line up row-for-row (their scrollHeights
          are computed independently and drift by sub-pixel rounding), and any JS-event-based sync
          is a frame behind the browser's own native scroll paint. A single table has exactly one
          native scroll to paint, so the sticky columns are physically part of the same rows —
          there is nothing left that could go out of alignment. */}
      <div className="table-scroll" onScroll={() => setOpenFilter(null)}>
        <table className="payroll-table">
          <thead>
            <tr>
              <th className={`col-sticky-1${isFilterActive('code') ? ' th-filter-active' : ''}`}>{renderHeaderLabel('code', 'Emp Code')}</th>
              <th className={`col-sticky-2${isFilterActive('name') ? ' th-filter-active' : ''}`}>{renderHeaderLabel('name', 'Employee Name')}</th>
              {columns.map((c) => (
                <th key={c.key} className={isFilterActive(c.key) ? 'th-filter-active' : undefined}>{renderHeaderLabel(c.key, c.label)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredRows.length === 0 ? (
              <tr>
                <td colSpan={columns.length + 2} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 24 }}>
                  No payroll rows available.
                </td>
              </tr>
            ) : (
              filteredRows.map((r, i) => (
                <tr key={r.code || i} className={r.category === 'Blue' ? 'row-blue-collar' : ''}>
                  <td className="col-sticky-1"><b>{Number.isNaN(r.code) ? '—' : r.code}</b></td>
                  <td className="col-sticky-2" title={r.name}>{r.name}</td>
                  {columns.map((c) => {
                    if (c.key === 'category') {
                      const catClass = r.category === 'Blue' ? 'badge-blue' : 'badge-white';
                      return (
                        <td key={c.key}>
                          <span className={`badge-cat ${catClass}`}>{r.category}</span>
                        </td>
                      );
                    }
                    if (c.key === 'remarks') {
                      return (
                        <td key={c.key}>
                          {r.remarks ? <span className="remark-tag">⚑ {r.remarks}</span> : null}
                        </td>
                      );
                    }
                    if (TEXT_FALLBACK_COLS.has(c.key)) {
                      return <td key={c.key}>{r[c.key] || '—'}</td>;
                    }
                    const cls = c.net ? 'num net-cell' : 'num';
                    const value = r[c.key];
                    return (
                      <td key={c.key} className={cls}>
                        {typeof value === 'string' ? value : fmt(value as number)}
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {openFilter && createPortal(
        <>
          <div className="col-filter-scrim" onClick={() => setOpenFilter(null)} />
          <div
            className="col-filter-dropdown"
            ref={dropdownRef}
            style={{
              top: openFilter.anchor.bottom + 4,
              left: Math.min(openFilter.anchor.left, window.innerWidth - 240),
            }}
          >
            <input
              className="col-filter-search"
              type="text"
              placeholder={`Search ${openFilter.label}…`}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
            />
            <div className="col-filter-actions">
              <button type="button" onClick={() => setPendingSelection(new Set(valuesByKey.get(openFilter.key) || []))}>
                Select All
              </button>
              <button type="button" onClick={() => setPendingSelection(new Set())}>
                Clear All
              </button>
            </div>
            <div className="col-filter-list">
              {visibleOptions.length === 0 ? (
                <div className="col-filter-empty">No matching values</div>
              ) : (
                visibleOptions.map((v) => (
                  <label key={v} className="col-filter-item">
                    <input
                      type="checkbox"
                      checked={pendingSelection.has(v)}
                      onChange={() => toggleValue(v)}
                    />
                    <span>{v}</span>
                  </label>
                ))
              )}
            </div>
            <div className="col-filter-footer">
              <button type="button" className="col-filter-cancel" onClick={() => setOpenFilter(null)}>Cancel</button>
              <button type="button" className="col-filter-ok" onClick={applyOpenFilter}>OK</button>
            </div>
          </div>
        </>,
        document.body,
      )}
    </div>
  );
}
