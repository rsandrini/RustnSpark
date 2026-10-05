import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { ApiError } from '../../api/client';
import { useRegister } from './auth.hooks';

export function RegisterPage() {
  const { t } = useTranslation();
  const register = useRegister();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    register.mutate({ name, email, password });
  };

  const error = register.error;
  const errorKey =
    error instanceof ApiError
      ? error.status === 409
        ? 'register.error.conflict'
        : error.status === 400
          ? 'register.error.invalid'
          : error.status === 429
            ? 'error.RATE_LIMITED'
            : 'register.error.generic'
      : 'register.error.generic';

  return (
    <main className="app auth">
      <section className="panel">
        <h1>{t('register.title')}</h1>
        <form onSubmit={handleSubmit}>
          <div className="field">
            <label className="lbl" htmlFor="name">
              {t('register.nameLabel')}
            </label>
            <input
              className="input"
              id="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              minLength={3}
              maxLength={24}
              pattern="[A-Za-z0-9_\-]+"
              title={t('register.nameHint')}
              autoComplete="username"
              aria-describedby="name-hint"
            />
            <p className="muted hint" id="name-hint">
              {t('register.nameHint')}
            </p>
          </div>
          <div className="field">
            <label className="lbl" htmlFor="email">
              {t('register.emailLabel')}
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
              {t('register.passwordLabel')}
            </label>
            <input
              className="input"
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={10}
              maxLength={128}
              autoComplete="new-password"
              aria-describedby="password-hint"
            />
            <p className="muted hint" id="password-hint">
              {t('register.passwordHint')}
            </p>
          </div>
          <button className="btn primary block" type="submit" disabled={register.isPending}>
            {t('register.submit')}
          </button>
          {register.isError && (
            <p className="error-text" role="alert">
              {t(errorKey)}
            </p>
          )}
        </form>
        <p className="auth-alt">
          <Link to="/login">{t('register.loginLink')}</Link>
        </p>
      </section>
    </main>
  );
}
