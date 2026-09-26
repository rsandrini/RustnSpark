import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useAuth, useLogout } from '../features/auth/auth.hooks';

export function HomePage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const logout = useLogout();

  return (
    <main className="app auth">
      <section className="panel">
        <h1>{t('home.title')}</h1>
        {user ? (
          <>
            <p>{t('home.greeting', { name: user.name })}</p>
            <p className="stack">
              <Link className="btn primary block" to="/hangar">
                {t('home.play')}
              </Link>
              {user.role === 'ADMIN' && (
                <Link className="btn block" to="/admin">
                  {t('home.adminLink')}
                </Link>
              )}
              <button className="btn block" type="button" onClick={() => logout.mutate()}>
                {t('home.logout')}
              </button>
            </p>
          </>
        ) : (
          <>
            <p className="stack">
              <Link className="btn primary block" to="/login">
                {t('home.loginLink')}
              </Link>
              <Link className="btn block" to="/register">
                {t('home.registerLink')}
              </Link>
            </p>
          </>
        )}
      </section>
    </main>
  );
}
