import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import LoginPage from './components/LoginPage';
import { getToken, setToken, clearToken, onLoggedOut, installFetchAuthInterceptor } from './auth';
import './styles/index.css';

installFetchAuthInterceptor();

function AuthGate() {
  const [token, setTokenState] = useState<string | null>(() => getToken());

  useEffect(() => onLoggedOut(() => setTokenState(null)), []);

  if (!token) {
    return (
      <LoginPage
        onLoggedIn={(t) => {
          setToken(t);
          setTokenState(t);
        }}
      />
    );
  }

  return (
    <App
      onLogout={() => {
        fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
        clearToken();
        setTokenState(null);
      }}
    />
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthGate />
  </React.StrictMode>,
);
