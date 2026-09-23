import { describe, it, expect } from 'vitest';
import en from './en.json';
import ptBR from './pt-BR.json';

function collectKeys(
  obj: Record<string, unknown>,
  prefix = '',
): string[] {
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
