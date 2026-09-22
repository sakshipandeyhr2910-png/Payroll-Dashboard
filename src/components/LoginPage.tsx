import { useState, type FormEvent } from 'react';
import type { LoginResult } from '../auth';

interface Props {
  onLoggedIn: (result: LoginResult) => void;
}

type Tab = 'hr' | 'employee';
type EmployeeStep = 'identifier' | 'otp';

function HrAdminForm({ onLoggedIn }: Props) {
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
    <form onSubmit={handleSubmit}>
      <label className="login-label" htmlFor="login-username">Username</label>
      <input
        id="login-username"
        className="login-input"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        autoFocus
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
  );
}

function EmployeeLoginForm({ onLoggedIn }: Props) {
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

  if (step === 'otp') {
    return (
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
        <button className="login-btn" type="submit" disabled={loading || otp.length !== 6}>
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
    );
  }

  return (
    <form onSubmit={requestOtp}>
      <label className="login-label" htmlFor="login-identifier">Employee ID or registered email</label>
      <input
        id="login-identifier"
        className="login-input"
        value={identifier}
        onChange={(e) => setIdentifier(e.target.value)}
        autoFocus
        autoComplete="username"
        placeholder="e.g. 3595 or you@koenig-solutions.com"
      />
      {error && <div className="login-error">{error}</div>}
      <button className="login-btn" type="submit" disabled={loading || !identifier.trim()}>
        {loading ? 'Sending…' : 'Send OTP'}
      </button>
    </form>
  );
}

export default function LoginPage({ onLoggedIn }: Props) {
  const [tab, setTab] = useState<Tab>('hr');

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-title">KOENIG</div>
        <div className="login-subtitle">Payroll Dashboard</div>
        <div className="login-tabs">
          <button
            type="button"
            className={`login-tab${tab === 'hr' ? ' active' : ''}`}
            onClick={() => setTab('hr')}
          >
            HR Admin
          </button>
          <button
            type="button"
            className={`login-tab${tab === 'employee' ? ' active' : ''}`}
            onClick={() => setTab('employee')}
          >
            Employee Login
          </button>
        </div>
        {tab === 'hr' ? <HrAdminForm onLoggedIn={onLoggedIn} /> : <EmployeeLoginForm onLoggedIn={onLoggedIn} />}
      </div>
    </div>
  );
}
