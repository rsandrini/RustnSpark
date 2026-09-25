import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useAuth, useLogout } from '../features/auth/auth.hooks';

export function HomePage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const logout = useLogout();

  return (
    <main>
      <h1>{t('home.title')}</h1>
      {user ? (
        <>
          <p>{t('home.greeting', { name: user.name })}</p>
          <button type="button" onClick={() => logout.mutate()}>
            {t('home.logout')}
          </button>
          {user.role === 'ADMIN' && <Link to="/admin">{t('home.adminLink')}</Link>}
        </>
      ) : (
        <>
          <Link to="/login">{t('home.loginLink')}</Link>
          <Link to="/register">{t('home.registerLink')}</Link>
        </>
      )}
    </main>
  );
}
