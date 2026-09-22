import { describe, expect, it } from '@jest/globals';
import { DEFAULT_LOCALE, resolveLocaleFromHeader, SUPPORTED_LOCALES } from './locale.js';

describe('locale module', () => {
  it('supports exactly en and pt-BR, defaulting to en (D22)', () => {
    expect(SUPPORTED_LOCALES).toEqual(['en', 'pt-BR']);
    expect(DEFAULT_LOCALE).toBe('en');
  });

  describe('resolveLocaleFromHeader', () => {
    it.each([
      ['undefined header', undefined, 'en'],
      ['empty header', '', 'en'],
      ['plain en', 'en', 'en'],
      ['plain pt-BR', 'pt-BR', 'pt-BR'],
      ['case-insensitive tag', 'PT-br', 'pt-BR'],
      ['bare pt', 'pt', 'pt-BR'],
      ['another Portuguese variant', 'pt-PT', 'pt-BR'],
      ['regional English', 'en-US,en;q=0.9', 'en'],
      ['unsupported language only', 'fr-FR,fr;q=0.8', 'en'],
      ['quality value ordering', 'en;q=0.5,pt-BR;q=0.9', 'pt-BR'],
      ['header order breaks a quality tie', 'pt-BR;q=0.8,en;q=0.8', 'pt-BR'],
      ['q=0 means not acceptable', 'pt-BR;q=0,en;q=0.5', 'en'],
      ['wildcard matches nothing', '*', 'en'],
      ['malformed quality value', 'pt-BR;q=oops,en;q=0.5', 'en'],
      ['whitespace tolerance', ' pt-BR ; q=0.9 , en ; q=0.1 ', 'pt-BR'],
    ])('%s resolves to %s', (_label, header, expected) => {
      expect(resolveLocaleFromHeader(header)).toBe(expected);
    });
  });
});
