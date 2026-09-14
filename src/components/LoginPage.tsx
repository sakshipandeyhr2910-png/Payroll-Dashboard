import { useState, type FormEvent } from 'react';

interface Props {
  onLoggedIn: (token: string) => void;
}

export default function LoginPage({ onLoggedIn }: Props) {
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
        onLoggedIn(data.token);
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
    <div className="login-screen">
      <form className="login-card" onSubmit={handleSubmit}>
        <div className="login-title">KOENIG</div>
        <div className="login-subtitle">Payroll Dashboard</div>
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
    </div>
  );
}
