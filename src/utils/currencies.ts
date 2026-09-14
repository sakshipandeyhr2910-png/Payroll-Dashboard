import { ENTITY_ROWS } from '../data/entityRows';

/** Distinct payout currencies actually present in an entity's payroll rows (falls back to the entity's primary currency when there are no rows or only one). */
export function entityCurrencies(slug: string, fallbackCurrency: string): string[] {
  const rows = ENTITY_ROWS[slug];
  if (!rows || rows.length === 0) return [fallbackCurrency];
  const set = new Set(rows.map((r) => r.currency));
  return set.size > 0 ? Array.from(set) : [fallbackCurrency];
}
