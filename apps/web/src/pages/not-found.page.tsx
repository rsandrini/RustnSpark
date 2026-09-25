import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

export function NotFoundPage() {
  const { t } = useTranslation();

  return (
    <main>
      <h1>{t('notFound.title')}</h1>
      <Link to="/">{t('notFound.homeLink')}</Link>
    </main>
  );
}
