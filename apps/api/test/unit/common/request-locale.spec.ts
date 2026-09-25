import { describe, expect, it } from '@jest/globals';
import { resolveRequestLocale } from '../../../src/common/locale/request-locale.js';

/**
 * S9.2: the resolver extracted from `parts.service.catalogForPlayer` — the
 * reports layer must reuse this exact precedence (explicit ?locale= wins,
 * then the player's saved locale, then the default), not a copy of it.
 */
describe('resolveRequestLocale', () => {
  it('prefers an explicit parameter over the saved locale', () => {
    expect(resolveRequestLocale('pt', 'en')).toBe('pt-BR');
    expect(resolveRequestLocale('en', 'pt-BR')).toBe('en');
  });

  it('falls back to the saved locale when no parameter is given', () => {
    expect(resolveRequestLocale(undefined, 'pt-BR')).toBe('pt-BR');
    expect(resolveRequestLocale(undefined, 'en')).toBe('en');
  });

  it('falls back to the default when neither exists', () => {
    expect(resolveRequestLocale(undefined, undefined)).toBe('en');
    expect(resolveRequestLocale(undefined, null as unknown as undefined)).toBe('en');
  });

  it('normalizes unsupported values through parseLocale', () => {
    // Explicit ?locale= values go through parseLocale, which is strict by
    // design — primary-subtag matching (`pt-PT` → `pt-BR`) only exists in
    // resolveLocaleFromHeader for Accept-Language.
    expect(resolveRequestLocale('pt-PT', 'en')).toBe('en');
    expect(resolveRequestLocale('fr', 'pt-BR')).toBe('en');
    expect(resolveRequestLocale(undefined, 'fr')).toBe('en');
    expect(resolveRequestLocale('pt', 'en')).toBe('pt-BR');
  });
});
