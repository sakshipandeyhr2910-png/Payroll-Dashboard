import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import LoginPage from './components/LoginPage';
import EmployeeDashboard from './components/EmployeeDashboard';
import { getSession, setSession, clearToken, onLoggedOut, installFetchAuthInterceptor, type LoginResult } from './auth';
import './styles/index.css';

installFetchAuthInterceptor();

function AuthGate() {
  const [session, setSessionState] = useState<LoginResult | null>(() => getSession());

  useEffect(() => onLoggedOut(() => setSessionState(null)), []);

  if (!session) {
    return (
      <LoginPage
        onLoggedIn={(result) => {
          setSession(result);
          setSessionState(result);
        }}
      />
    );
  }

  const handleLogout = () => {
    // Same endpoint for both roles — it just revokes whatever token is presented, regardless of
    // whether it belongs to an HR or an employee session (see dashboardAuthPlugin.ts/
    // api/_lib/routes/authLogout.ts). /api/auth/* is deliberately exempted from the fetch
    // interceptor's auto-attached Authorization header (it's the public login/logout surface), so
    // this attaches it explicitly — otherwise the server never actually revokes the token, which
    // would stay valid until the process restarts even after "logging out".
    fetch('/api/auth/logout', { method: 'POST', headers: { Authorization: `Bearer ${session.token}` } }).catch(() => {});
    clearToken();
    setSessionState(null);
  };

  if (session.role === 'employee') {
    return <EmployeeDashboard employee={session.employee} onLogout={handleLogout} />;
  }

  return <App onLogout={handleLogout} />;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthGate />
  </React.StrictMode>,
);
