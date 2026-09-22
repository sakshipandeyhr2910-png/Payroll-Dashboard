import { useState, type FormEvent } from 'react';
import type { LoginResult } from '../auth';

interface Props {
  onLoggedIn: (result: LoginResult) => void;
}

type EmployeeStep = 'identifier' | 'otp';

function ShieldIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l7 3.2v5.3c0 4.6-3 8.3-7 9.5-4-1.2-7-4.9-7-9.5V6.2L12 3z" />
      <path d="M9 12.2l2 2 4-4.2" />
    </svg>
  );
}

function UserIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="3.6" />
      <path d="M4.5 20c.8-3.8 4-6 7.5-6s6.7 2.2 7.5 6" />
    </svg>
  );
}

function HrAdminCard({ onLoggedIn }: Props) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (data.ok) {
        onLoggedIn({ token: data.token, role: 'hr' });
      } else {
        setError(data.error || 'Invalid username or password');
      }
    } catch {
      setError('Could not reach the dashboard server');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-card">
      <div className="login-card-icon"><ShieldIcon /></div>
      <h2 className="login-card-title">HR Admin</h2>
      <p className="login-card-desc">Full access to every payroll module, entity, and report.</p>
      <form onSubmit={handleSubmit}>
        <label className="login-label" htmlFor="login-username">Username</label>
        <input
          id="login-username"
          className="login-input"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
        />
        <label className="login-label" htmlFor="login-password">Password</label>
        <input
          id="login-password"
          className="login-input"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
        />
        {error && <div className="login-error">{error}</div>}
        <button className="login-btn" type="submit" disabled={loading || !username || !password}>
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}

function EmployeeLoginCard({ onLoggedIn }: Props) {
  const [step, setStep] = useState<EmployeeStep>('identifier');
  const [identifier, setIdentifier] = useState('');
  const [otp, setOtp] = useState('');
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const requestOtp = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setLoading(true);
    try {
      const res = await fetch('/api/employee-auth/request-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier }),
      });
      const data = await res.json();
      if (data.ok) {
        setInfo(data.message || 'A verification code has been sent to your registered email.');
        setStep('otp');
      } else {
        setError(data.error || 'Could not send the verification code');
      }
    } catch {
      setError('Could not reach the dashboard server');
    } finally {
      setLoading(false);
    }
  };

  const verifyOtp = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/employee-auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, otp }),
      });
      const data = await res.json();
      if (data.ok) {
        onLoggedIn({ token: data.token, role: 'employee', employee: data.employee });
      } else {
        setError(data.error || 'Incorrect or expired code');
      }
    } catch {
      setError('Could not reach the dashboard server');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-card login-card--employee">
      <div className="login-card-icon"><UserIcon /></div>
      <h2 className="login-card-title">Employee Login</h2>
      <p className="login-card-desc">View your own payroll information — no other employee's data is accessible.</p>

      {step === 'otp' ? (
        <form onSubmit={verifyOtp}>
          {info && <div className="login-info">{info}</div>}
          <label className="login-label" htmlFor="login-otp">Verification code</label>
          <input
            id="login-otp"
            className="login-input"
            value={otp}
            onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            placeholder="6-digit code"
          />
          {error && <div className="login-error">{error}</div>}
          <button className="login-btn login-btn--employee" type="submit" disabled={loading || otp.length !== 6}>
            {loading ? 'Verifying…' : 'Verify & sign in'}
          </button>
          <button
            type="button"
            className="login-link-btn"
            onClick={() => { setStep('identifier'); setOtp(''); setError(null); setInfo(null); }}
          >
            Use a different Employee ID or email
          </button>
        </form>
      ) : (
        <form onSubmit={requestOtp}>
          <label className="login-label" htmlFor="login-identifier">Employee ID or registered email</label>
          <input
            id="login-identifier"
            className="login-input"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            autoComplete="username"
            placeholder="e.g. 3595 or you@koenig-solutions.com"
          />
          {error && <div className="login-error">{error}</div>}
          <button className="login-btn login-btn--employee" type="submit" disabled={loading || !identifier.trim()}>
            {loading ? 'Sending…' : 'Send OTP'}
          </button>
        </form>
      )}
    </div>
  );
}

export default function LoginPage({ onLoggedIn }: Props) {
  return (
    <div className="login-screen">
      <div className="login-brand">
        <div className="login-brand-title">KOENIG</div>
        <div className="login-brand-subtitle">Payroll Dashboard</div>
      </div>
      <div className="login-cards">
        <HrAdminCard onLoggedIn={onLoggedIn} />
        <EmployeeLoginCard onLoggedIn={onLoggedIn} />
      </div>
    </div>
  );
}
