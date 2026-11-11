import { describe, it, expect, vi } from 'vitest';
import en from './en.json';
import ptBR from './pt-BR.json';

function collectKeys(obj: Record<string, unknown>, prefix = ''): string[] {
  const keys: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    keys.push(fullKey);
    if (value !== null && typeof value === 'object') {
      keys.push(...collectKeys(value as Record<string, unknown>, fullKey));
    }
  }
  return keys;
}

describe('i18n', () => {
  it('has the same keys in en and pt-BR', () => {
    const enKeys = collectKeys(en).sort();
    const ptKeys = collectKeys(ptBR).sort();
    expect(ptKeys).toEqual(enKeys);
  });
});

describe('detectInitialLng', () => {
  it('opens in Brazilian Portuguese, whatever the browser says, unless a language was saved', async () => {
    const { detectInitialLng, LANGUAGE_STORAGE_KEY } = await import('./config');
    window.localStorage.removeItem(LANGUAGE_STORAGE_KEY);
    expect(detectInitialLng()).toBe('pt-BR');
    const lang = vi.spyOn(window.navigator, 'language', 'get').mockReturnValue('en-US');
    expect(detectInitialLng()).toBe('pt-BR');
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, 'en');
    expect(detectInitialLng()).toBe('en');
    window.localStorage.removeItem(LANGUAGE_STORAGE_KEY);
    lang.mockRestore();
  });
});
