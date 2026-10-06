import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { authApi } from './auth.api';

export function ResetPasswordPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = useMemo(() => params.get('token') ?? '', [params]);

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (password !== confirmPassword) {
      setError(t('resetPassword.error.mismatch'));
      return;
    }
    if (password.length < 10 || password.length > 128) {
      setError(t('resetPassword.error.invalidPassword'));
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      await authApi.resetPassword(token, password);
      setDone(true);
      setTimeout(() => {
        void navigate('/login');
      }, 2000);
    } catch {
      setError(t('resetPassword.error.invalidToken'));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main className="app auth">
      <section className="panel">
        <h1>{t('resetPassword.title')}</h1>
        {done ? (
          <p className="success-text">{t('resetPassword.success')}</p>
        ) : (
          <form onSubmit={(event) => void handleSubmit(event)}>
            <div className="field">
              <label className="lbl" htmlFor="password">
                {t('resetPassword.passwordLabel')}
              </label>
              <input
                className="input"
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="new-password"
              />
            </div>
            <div className="field">
              <label className="lbl" htmlFor="confirmPassword">
                {t('resetPassword.confirmPasswordLabel')}
              </label>
              <input
                className="input"
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                autoComplete="new-password"
              />
            </div>
            <button className="btn primary block" type="submit" disabled={isLoading || !token}>
              {t('resetPassword.submit')}
            </button>
            {error && (
              <p className="error-text" role="alert">
                {error}
              </p>
            )}
          </form>
        )}
        <p className="auth-alt">
          <Link to="/login">{t('resetPassword.backToLogin')}</Link>
        </p>
      </section>
    </main>
  );
}
