import * as XLSX from 'xlsx';
import { TEXT_FALLBACK_COLS, type PayrollColumn } from '../data/payrollColumns';
import type { Entity, PayrollRow } from '../types';

// Mirrors PayrollTable.tsx's displayValue() exactly (same TEXT_FALLBACK_COLS/remarks branching),
// but returns a typed value instead of an always-stringified one — numeric columns become real
// Excel numbers (so totals/sorting/filtering work in the spreadsheet), not comma-formatted text.
function exportCellValue(row: PayrollRow, key: PayrollColumn['key']): string | number {
  if (key === 'remarks') return row.remarks || '';
  if (TEXT_FALLBACK_COLS.has(key)) {
    return (row[key] as string | undefined) || '—';
  }
  const value = row[key];
  if (value === undefined || value === null) return '—';
  if (typeof value === 'string') return value;
  const n = Number(value);
  return Number.isNaN(n) ? '—' : Math.round(n * 100) / 100;
}

// Exports exactly what's currently on screen — the same filtered/live rows and visible columns
// PayrollTable.tsx is rendering — rather than a static pre-baked sample file, so what a user
// downloads always matches what they were just looking at (live API data for Koenig/Rayontara,
// the entity's own sample data otherwise).
export function downloadXlsx(entity: Entity, rows: PayrollRow[], columns: PayrollColumn[]): void {
  const header = ['Emp Code', 'Employee Name', ...columns.map((c) => c.label)];
  const data: (string | number)[][] = rows.map((row) => [
    Number.isNaN(row.code) ? '—' : row.code,
    row.name,
    ...columns.map((c) => exportCellValue(row, c.key)),
  ]);

  const worksheet = XLSX.utils.aoa_to_sheet([header, ...data]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, entity.name.slice(0, 31));
  XLSX.writeFile(workbook, `Salary_Sheet_${entity.full.replace(/\s+/g, '_')}.xlsx`);
}
