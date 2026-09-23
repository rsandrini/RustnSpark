import { useTranslation } from 'react-i18next';
import { authApi } from '../features/auth/auth.api';
import { useAuth } from '../features/auth/auth.hooks';
import { LANGUAGE_STORAGE_KEY, supportedLngs, type SupportedLng } from './config';

// Language names are shown in their own language so they stay readable after a wrong switch.
const LANGUAGE_NAMES: Record<SupportedLng, string> = {
  en: 'English',
  'pt-BR': 'Português (Brasil)',
};

export function LanguageSwitcher() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();

  const handleChange = async (event: React.ChangeEvent<HTMLSelectElement>) => {
    const next = event.target.value as SupportedLng;
    await i18n.changeLanguage(next);
    try {
      window.localStorage.setItem(LANGUAGE_STORAGE_KEY, next);
    } catch {
      // the choice still applies for this session
    }
    if (user) {
      // Keep the server-side locale (used for rendered reports) in step; UI already switched.
      await authApi.updateLocale({ locale: next }).catch(() => undefined);
    }
  };

  return (
    <div>
      <label htmlFor="language-switcher">{t('language.label')}</label>{' '}
      <select id="language-switcher" value={i18n.language} onChange={(e) => void handleChange(e)}>
        {supportedLngs.map((lng) => (
          <option key={lng} value={lng}>
            {LANGUAGE_NAMES[lng]}
          </option>
        ))}
      </select>
    </div>
  );
}
