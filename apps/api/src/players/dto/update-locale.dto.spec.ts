import { describe, expect, it } from '@jest/globals';
import { validate } from 'class-validator';
import { UpdateLocaleDto } from './update-locale.dto.js';

async function invalidProperties(payload: Record<string, unknown>): Promise<string[]> {
  const dto = Object.assign(new UpdateLocaleDto(), payload);
  const errors = await validate(dto);
  return errors.map((error) => error.property);
}

describe('UpdateLocaleDto validation', () => {
  it.each([['en'], ['pt-BR']])('accepts locale %s', async (locale) => {
    await expect(invalidProperties({ locale })).resolves.toEqual([]);
  });

  it.each([
    ['unsupported locale', { locale: 'fr' }],
    ['locale is case-sensitive', { locale: 'pt-br' }],
    ['missing locale', {}],
    ['non-string locale', { locale: 42 }],
  ])('rejects %s', async (_label, payload) => {
    await expect(invalidProperties(payload)).resolves.toEqual(['locale']);
  });
});
