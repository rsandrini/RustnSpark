import { useTranslation } from 'react-i18next';
import { useAuth, useLogout } from '../auth/auth.hooks';

export function AdminShell() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const logout = useLogout();

  return (
    <div>
      <header>
        <h1>{t('admin.title')}</h1>
        <span>{user?.email}</span>
        <button type="button" onClick={() => logout.mutate()}>
          {t('admin.logout')}
        </button>
      </header>
      <main>
        <p>{t('admin.placeholder')}</p>
      </main>
    </div>
  );
}
