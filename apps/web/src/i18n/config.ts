export const defaultLng = 'en';
export const fallbackLng = 'en';
export const supportedLngs = ['en', 'pt-BR'] as const;

export type SupportedLng = (typeof supportedLngs)[number];
