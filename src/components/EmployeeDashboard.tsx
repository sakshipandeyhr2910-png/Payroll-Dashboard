import { useEffect, useState } from 'react';
import type { EmployeeIdentity } from '../auth';
import MonthControl from './MonthControl';
import { currentMonth } from '../utils/month';

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
  const [selectedMonth, setSelectedMonth] = useState(currentMonth());
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
  const totalDeductions = deductionRows.reduce((sum, [, v]) => sum + v, 0);

  const additionRows: [string, number][] = data ? [
    ['NPS (Employer + Employee)', data.nps],
    ['Appraisal Arrear', data.appraisalArrear],
    ['WFH Reimbursement', data.wfh],
  ] : [];
  const totalAdditions = additionRows.reduce((sum, [, v]) => sum + v, 0);

  const profileFields: [string, string | null][] = data ? [
    ['Department', data.department],
    ['Manager', data.manager],
    ['Base Location', data.location],
    ['Country', data.country],
    ['Bank Name', data.bankName],
    ['Bank Account No.', data.bankAccount],
    ['IFSC Code', data.ifsc],
    ['UAN', data.uan],
    ['Registered Email', data.email],
  ] : [];

  return (
    <div className="app">
      <div className="main" style={{ marginLeft: 0 }}>
        <header className="topbar">
          <div className="topbar-brand">
            <div className="topbar-brand-title">KOENIG</div>
            <div className="topbar-brand-sub">Employee Payroll Portal</div>
          </div>
          <div className="topbar-right">
            <div className="user-chip">
              <div className="user-avatar">{initials(employee.name)}</div>
              {employee.name}
            </div>
            <button className="logout-btn" onClick={onLogout}>Log out</button>
          </div>
        </header>
        <div className="content">
          <div className="page-head">
            <div>
              <h1 className="page-title">My Payroll</h1>
              <p className="page-desc">Employee Code {employee.code} · {employee.entitySlug}</p>
            </div>
            <MonthControl selectedMonth={selectedMonth} onChange={setSelectedMonth} />
          </div>

          {loading && <p className="page-desc">Loading your payroll data…</p>}
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

              <div className="payroll-grid">
                <div className="payroll-card">
                  <h3 className="payroll-card-title">
                    <span className="dot" style={{ background: '#e05252' }} />
                    Deductions
                  </h3>
                  {deductionRows.map(([label, value]) => (
                    <div className="payroll-row" key={label}>
                      <span className="payroll-row-label">{label}</span>
                      <span className="payroll-row-value">{fmtAmount(value, data.currency)}</span>
                    </div>
                  ))}
                  <div className="payroll-total-row">
                    <span>Total Deductions</span>
                    <span>{fmtAmount(totalDeductions, data.currency)}</span>
                  </div>
                </div>
                <div className="payroll-card">
                  <h3 className="payroll-card-title">
                    <span className="dot" style={{ background: 'var(--good)' }} />
                    Additions
                  </h3>
                  {additionRows.map(([label, value]) => (
                    <div className="payroll-row" key={label}>
                      <span className="payroll-row-label">{label}</span>
                      <span className="payroll-row-value">{fmtAmount(value, data.currency)}</span>
                    </div>
                  ))}
                  <div className="payroll-total-row">
                    <span>Total Additions</span>
                    <span>{fmtAmount(totalAdditions, data.currency)}</span>
                  </div>
                </div>
              </div>

              <div className="payroll-card" style={{ marginTop: 20 }}>
                <h3 className="payroll-card-title">
                  <span className="dot" style={{ background: 'var(--purple)' }} />
                  Profile &amp; Bank Details
                </h3>
                <div className="profile-grid">
                  {profileFields.map(([label, value]) => (
                    <div key={label}>
                      <div className="profile-field-label">{label}</div>
                      <div className="profile-field-value">{value || '—'}</div>
                    </div>
                  ))}
                </div>
              </div>

              <p className="page-desc" style={{ marginTop: 20 }}>
                Meal Pass deductions aren't reflected in Net Payable yet — every other figure
                above is computed the same way HR's Payroll Register computes it for this month.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
