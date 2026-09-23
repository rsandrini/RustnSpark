import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
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

  return (
    <main>
      <h1>{t('register.title')}</h1>
      <form onSubmit={handleSubmit}>
        <div>
          <label htmlFor="name">{t('register.nameLabel')}</label>
          <input
            id="name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </div>
        <div>
          <label htmlFor="email">{t('register.emailLabel')}</label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div>
          <label htmlFor="password">{t('register.passwordLabel')}</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        <button type="submit" disabled={register.isPending}>
          {t('register.submit')}
        </button>
        {register.isError && (
          <p role="alert">{t('register.error.generic')}</p>
        )}
      </form>
      <Link to="/login">{t('register.loginLink')}</Link>
    </main>
  );
}
