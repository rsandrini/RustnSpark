import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { authApi } from './auth.api';

export function ForgotPasswordPage() {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsLoading(true);
    setError(null);
    try {
      await authApi.requestPasswordReset(email);
      setSubmitted(true);
    } catch {
      setError(t('forgotPassword.error.generic'));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main className="app auth">
      <section className="panel">
        <h1>{t('forgotPassword.title')}</h1>
        {submitted ? (
          <p className="success-text">{t('forgotPassword.success')}</p>
        ) : (
          <form onSubmit={(event) => void handleSubmit(event)}>
            <div className="field">
              <label className="lbl" htmlFor="email">
                {t('forgotPassword.emailLabel')}
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
            <button className="btn primary block" type="submit" disabled={isLoading}>
              {t('forgotPassword.submit')}
            </button>
            {error && (
              <p className="error-text" role="alert">
                {error}
              </p>
            )}
          </form>
        )}
        <p className="auth-alt">
          <Link to="/login">{t('forgotPassword.backToLogin')}</Link>
        </p>
      </section>
    </main>
  );
}
