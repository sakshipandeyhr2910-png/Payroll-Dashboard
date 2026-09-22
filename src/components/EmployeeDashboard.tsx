import { useEffect, useState } from 'react';
import type { EmployeeIdentity } from '../auth';

interface Props {
  employee: EmployeeIdentity;
  onLogout: () => void;
}

interface EmployeePayroll {
  code: number;
  entitySlug: string;
  name: string;
  email: string | null;
  designation: string | null;
  department: string | null;
  dateOfJoining: string | null;
  location: string | null;
  country: string | null;
  bankName: string | null;
  bankAccount: string | null;
  ifsc: string | null;
  uan: string | null;
  manager: string | null;
  resigned: boolean;
  resignationDate: string | null;
  payScale: number | null;
  currency: string | null;
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtAmount(n: number | null, currency: string | null): string {
  if (n === null) return '—';
  return `${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}${currency ? ` ${currency}` : ''}`;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}

export default function EmployeeDashboard({ employee, onLogout }: Props) {
  const [data, setData] = useState<EmployeePayroll | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch('/api/employee/payroll')
      .then((res) => res.json())
      .then((json) => {
        if (cancelled) return;
        if (json.ok) {
          setData(json.employee);
        } else {
          setError(json.error || 'Could not load your payroll data');
        }
      })
      .catch(() => {
        if (!cancelled) setError('Could not reach the dashboard server');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="app">
      <div className="main" style={{ marginLeft: 0 }}>
        <header className="topbar">
          <div className="search-box" style={{ visibility: 'hidden' }} />
          <div className="topbar-right">
            <div className="user-chip">
              <div className="user-avatar">{initials(employee.name)}</div>
              {employee.name}
            </div>
            <button className="logout-btn" onClick={onLogout}>Log out</button>
          </div>
        </header>
        <div className="content">
          <h1 className="page-title" style={{ marginTop: 24 }}>My Payroll</h1>
          <p className="page-desc">
            Employee Code {employee.code} · {employee.entitySlug}
          </p>

          {loading && <p>Loading your payroll data…</p>}
          {error && <div className="login-error" style={{ marginTop: 12 }}>{error}</div>}

          {data && (
            <>
              {data.resigned && (
                <div className="login-info" style={{ marginBottom: 16, background: '#fdecea', color: '#c0392b' }}>
                  ⚑ Date of Resignation: {fmtDate(data.resignationDate)}
                </div>
              )}

              <div className="kpi-grid">
                <div className="kpi-card">
                  <div className="kpi-num">{fmtAmount(data.payScale, data.currency)}</div>
                  <div className="kpi-label">Pay Scale</div>
                </div>
                <div className="kpi-card">
                  <div className="kpi-num" style={{ fontSize: 16 }}>{data.designation || '—'}</div>
                  <div className="kpi-label">Designation</div>
                </div>
                <div className="kpi-card">
                  <div className="kpi-num" style={{ fontSize: 16 }}>{fmtDate(data.dateOfJoining)}</div>
                  <div className="kpi-label">Date of Joining</div>
                </div>
                <div className="kpi-card">
                  <div className="kpi-num" style={{ fontSize: 16 }}>{data.location || '—'}</div>
                  <div className="kpi-label">Base Location</div>
                </div>
              </div>

              <table style={{ marginTop: 24, borderCollapse: 'collapse', width: '100%', maxWidth: 560 }}>
                <tbody>
                  {[
                    ['Department', data.department],
                    ['Manager', data.manager],
                    ['Country', data.country],
                    ['Bank Name', data.bankName],
                    ['Bank Account No.', data.bankAccount],
                    ['IFSC Code', data.ifsc],
                    ['UAN', data.uan],
                    ['Registered Email', data.email],
                  ].map(([label, value]) => (
                    <tr key={label} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '8px 12px', fontWeight: 600, color: 'var(--text-muted)', fontSize: 13 }}>{label}</td>
                      <td style={{ padding: '8px 12px', fontSize: 13 }}>{value || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <p className="page-desc" style={{ marginTop: 24 }}>
                Showing your own profile and Pay Scale only. A full monthly Net Payable breakdown
                (loan deductions, recovery, TDS, leave, etc., matching what HR sees) is coming in a
                future update.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
