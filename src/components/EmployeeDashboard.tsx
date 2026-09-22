import { useEffect, useState } from 'react';
import type { EmployeeIdentity } from '../auth';
import MonthControl from './MonthControl';
import { BASE_MONTH } from '../utils/month';

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
  currency: string | null;
  salary: number | null;
  pf: number;
  esi: number;
  loan: number;
  tds: number;
  nps: number;
  vpf: number;
  tada: number;
  recovery: number;
  professionalTax: number;
  appraisalArrear: number;
  wfh: number;
  netPayable: number | null;
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtAmount(n: number | null | undefined, currency: string | null): string {
  if (n === null || n === undefined) return '—';
  return `${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}${currency ? ` ${currency}` : ''}`;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}

export default function EmployeeDashboard({ employee, onLogout }: Props) {
  const [selectedMonth, setSelectedMonth] = useState(BASE_MONTH);
  const [data, setData] = useState<EmployeePayroll | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/employee/payroll?month=${encodeURIComponent(selectedMonth)}`)
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
  }, [selectedMonth]);

  const deductionRows: [string, number][] = data ? [
    ['PF', data.pf],
    ['ESI', data.esi],
    ['Loan Deduction', data.loan],
    ['TDS', data.tds],
    ['VPF', data.vpf],
    ['TA/DA', data.tada],
    ['Recovery', data.recovery],
    ['Professional Tax', data.professionalTax],
  ] : [];

  const additionRows: [string, number][] = data ? [
    ['NPS (Employer + Employee)', data.nps],
    ['Appraisal Arrear', data.appraisalArrear],
    ['WFH Reimbursement', data.wfh],
  ] : [];

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
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginTop: 24 }}>
            <div>
              <h1 className="page-title">My Payroll</h1>
              <p className="page-desc">Employee Code {employee.code} · {employee.entitySlug}</p>
            </div>
            <MonthControl selectedMonth={selectedMonth} onChange={setSelectedMonth} />
          </div>

          {loading && <p>Loading your payroll data…</p>}
          {error && <div className="login-error" style={{ marginTop: 12 }}>{error}</div>}

          {data && !loading && (
            <>
              {data.resigned && (
                <div className="login-info" style={{ marginBottom: 16, background: '#fdecea', color: '#c0392b' }}>
                  Date of Resignation: {fmtDate(data.resignationDate)}
                </div>
              )}

              <div className="kpi-grid">
                <div className="kpi-card">
                  <div className="kpi-num">{fmtAmount(data.salary, data.currency)}</div>
                  <div className="kpi-label">Salary this month</div>
                </div>
                <div className="kpi-card" style={{ borderTopColor: 'var(--good)' }}>
                  <div className="kpi-num" style={{ color: 'var(--good)' }}>{fmtAmount(data.netPayable, data.currency)}</div>
                  <div className="kpi-label">Net Payable</div>
                </div>
                <div className="kpi-card">
                  <div className="kpi-num" style={{ fontSize: 16 }}>{data.designation || '—'}</div>
                  <div className="kpi-label">Designation</div>
                </div>
                <div className="kpi-card">
                  <div className="kpi-num" style={{ fontSize: 16 }}>{fmtDate(data.dateOfJoining)}</div>
                  <div className="kpi-label">Date of Joining</div>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginTop: 8 }}>
                <div style={{ flex: '1 1 260px' }}>
                  <h3 style={{ fontSize: 13, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 8 }}>Deductions</h3>
                  <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                    <tbody>
                      {deductionRows.map(([label, value]) => (
                        <tr key={label} style={{ borderBottom: '1px solid var(--border)' }}>
                          <td style={{ padding: '7px 10px', fontSize: 13, color: 'var(--text-muted)' }}>{label}</td>
                          <td style={{ padding: '7px 10px', fontSize: 13, textAlign: 'right' }}>{fmtAmount(value, data.currency)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div style={{ flex: '1 1 260px' }}>
                  <h3 style={{ fontSize: 13, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 8 }}>Additions</h3>
                  <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                    <tbody>
                      {additionRows.map(([label, value]) => (
                        <tr key={label} style={{ borderBottom: '1px solid var(--border)' }}>
                          <td style={{ padding: '7px 10px', fontSize: 13, color: 'var(--text-muted)' }}>{label}</td>
                          <td style={{ padding: '7px 10px', fontSize: 13, textAlign: 'right' }}>{fmtAmount(value, data.currency)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <table style={{ marginTop: 28, borderCollapse: 'collapse', width: '100%', maxWidth: 560 }}>
                <tbody>
                  {[
                    ['Department', data.department],
                    ['Manager', data.manager],
                    ['Base Location', data.location],
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
                Meal Pass deductions aren't reflected in Net Payable yet — every other figure
                (Salary, PF, ESI, Loan, TDS, NPS, VPF, TA/DA, Recovery, Professional Tax, Appraisal
                Arrear, WFH) is computed the same way HR's Payroll Register computes it for this
                month.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
