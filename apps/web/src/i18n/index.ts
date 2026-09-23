import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { defaultLng, fallbackLng, supportedLngs } from './config';
import { resources } from './resources';

void i18n.use(initReactI18next).init({
  resources,
  lng: defaultLng,
  fallbackLng,
  supportedLngs: [...supportedLngs],
  interpolation: {
    escapeValue: false,
  },
  react: {
    useSuspense: false,
  },
});

export default i18n;
