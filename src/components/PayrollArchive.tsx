import type { Entity, PayrollRow } from '../types';
import type { PayrollColumn } from '../data/payrollColumns';
import { downloadXlsx } from '../utils/xlsxExport';
import { monthLabel } from '../utils/month';

interface Props {
  entity: Entity;
  columns: PayrollColumn[];
  selectedMonth: string;
  entityIsLiveNow: boolean;
  monthIsCompleted: boolean;
  snapshotStatus: 'unchecked' | 'none' | 'frozen';
  rows: PayrollRow[];
  onClose: () => void;
}

// The "Payroll" card — shows the status of whichever single month the entity page is currently on
// (see EntityPage.tsx's MonthControl), rather than a separate browsable multi-month archive: to see
// a different month's file, step the entity page itself to that month first, then reopen this. All
// the state driving it (monthIsCompleted, snapshotStatus, rows) is exactly what EntityPage.tsx
// already computed to render the Payroll Register beneath it — this never fetches on its own, so
// there's no separate loading state to get out of sync with what's on screen.
export default function PayrollArchive({ entity, columns, selectedMonth, entityIsLiveNow, monthIsCompleted, snapshotStatus, rows, onClose }: Props) {
  const label = monthLabel(selectedMonth);

  const handleDownload = () => {
    downloadXlsx(entity, rows, columns, label.replace(/\s+/g, '_'));
  };

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">Payroll — {entity.name}</div>
          <button className="modal-close-btn" onClick={onClose} aria-label="Close">×</button>
        </div>
        <p className="modal-desc">
          One immutable snapshot per month, captured automatically at month-end and never
          overwritten.
        </p>

        {!monthIsCompleted && (
          <div className="payroll-archive-empty">
            {label} is still in progress — it hasn't been captured yet. It will be added
            automatically once the month ends. Step to a past month above to download an
            already-captured payroll file.
          </div>
        )}

        {monthIsCompleted && entityIsLiveNow && snapshotStatus !== 'frozen' && (
          <div className="payroll-archive-empty">
            Capturing {label} payroll now — this usually only takes a moment. Reopen this once the
            Payroll Register below has finished loading.
          </div>
        )}

        {monthIsCompleted && !entityIsLiveNow && (
          <div className="payroll-archive-empty">
            {label}'s payroll data hasn't finished loading yet — reopen this once the Payroll
            Register below is showing.
          </div>
        )}

        {monthIsCompleted && snapshotStatus === 'frozen' && (
          <div className="payroll-archive-row">
            <span className="payroll-archive-month">{label}</span>
            <button className="payroll-archive-download-btn" onClick={handleDownload}>
              Download
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
