import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { ApiError } from '../../api/client';
import { useLogin } from './auth.hooks';

export function LoginPage() {
  const { t } = useTranslation();
  const login = useLogin();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    login.mutate({ email, password });
  };

  const rateLimited = login.error instanceof ApiError && login.error.status === 429;

  return (
    <main className="app auth">
      <section className="panel">
        <h1>{t('login.title')}</h1>
        <form onSubmit={handleSubmit}>
          <div className="field">
            <label className="lbl" htmlFor="email">
              {t('login.emailLabel')}
            </label>
            <input
              className="input"
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </div>
          <div className="field">
            <label className="lbl" htmlFor="password">
              {t('login.passwordLabel')}
            </label>
            <input
              className="input"
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
          </div>
          <button className="btn primary block" type="submit" disabled={login.isPending}>
            {t('login.submit')}
          </button>
          {login.isError && (
            <p className="error-text" role="alert">
              {t(rateLimited ? 'error.RATE_LIMITED' : 'login.error.invalidCredentials')}
            </p>
          )}
        </form>
        <p className="auth-alt">
          <Link to="/register">{t('login.registerLink')}</Link>
        </p>
      </section>
    </main>
  );
}
