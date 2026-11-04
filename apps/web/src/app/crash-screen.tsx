import { useTranslation } from 'react-i18next';

/** What the pilot sees if the screen itself crashes (the error is reported, when tracking is on). */
export function CrashScreen() {
  const { t } = useTranslation();
  return (
    <main className="app" role="alert">
      <h1>{t('crash.title')}</h1>
      <p>{t('crash.body')}</p>
      <button type="button" className="btn primary" onClick={() => window.location.reload()}>
        {t('crash.reload')}
      </button>
    </main>
  );
}
