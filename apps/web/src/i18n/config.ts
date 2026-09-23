export const defaultLng = 'en';
export const fallbackLng = 'en';
export const supportedLngs = ['en', 'pt-BR'] as const;

export type SupportedLng = (typeof supportedLngs)[number];

export const LANGUAGE_STORAGE_KEY = 'rs.language';

function isSupported(value: string | null | undefined): value is SupportedLng {
  return (supportedLngs as readonly string[]).includes(value ?? '');
}

// Saved choice first, then the browser language (any pt-* maps to pt-BR), then the default.
export function detectInitialLng(): SupportedLng {
  try {
    const saved = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (isSupported(saved)) return saved;
  } catch {
    // storage can be unavailable (private mode); fall through to the browser language.
  }
  const browser = typeof navigator === 'undefined' ? '' : navigator.language;
  return browser.toLowerCase().startsWith('pt') ? 'pt-BR' : defaultLng;
}
