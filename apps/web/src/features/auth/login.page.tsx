import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
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

  return (
    <main>
      <h1>{t('login.title')}</h1>
      <form onSubmit={handleSubmit}>
        <div>
          <label htmlFor="email">{t('login.emailLabel')}</label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div>
          <label htmlFor="password">{t('login.passwordLabel')}</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        <button type="submit" disabled={login.isPending}>
          {t('login.submit')}
        </button>
        {login.isError && <p role="alert">{t('login.error.invalidCredentials')}</p>}
      </form>
      <Link to="/register">{t('login.registerLink')}</Link>
    </main>
  );
}
