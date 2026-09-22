import { describe, expect, it } from '@jest/globals';
import { validate } from 'class-validator';
import { RegisterDto } from './register.dto.js';

async function invalidProperties(payload: Record<string, unknown>): Promise<string[]> {
  const dto = Object.assign(new RegisterDto(), payload);
  const errors = await validate(dto);
  return errors.map((error) => error.property).sort();
}

const VALID: Record<string, unknown> = {
  email: 'pilot@example.com',
  password: 'correct-horse-1',
  name: 'Pilot_One-2',
};

describe('RegisterDto validation', () => {
  it.each([
    ['minimal valid payload (locale optional)', VALID],
    ['explicit locale en', { ...VALID, locale: 'en' }],
    ['explicit locale pt-BR', { ...VALID, locale: 'pt-BR' }],
    ['password at the lower bound (10)', { ...VALID, password: 'x'.repeat(10) }],
    ['password at the upper bound (128)', { ...VALID, password: 'x'.repeat(128) }],
    ['name at the lower bound (3)', { ...VALID, name: 'abc' }],
    ['name at the upper bound (24)', { ...VALID, name: 'a'.repeat(24) }],
    ['name with the full allowed alphabet', { ...VALID, name: 'A_z-09' }],
  ])('accepts %s', async (_label, payload) => {
    await expect(invalidProperties(payload)).resolves.toEqual([]);
  });

  it.each([
    ['malformed email', { email: 'not-an-email' }, ['email']],
    ['empty email', { email: '' }, ['email']],
    ['non-string email', { email: 42 }, ['email']],
    ['password too short (9)', { password: 'x'.repeat(9) }, ['password']],
    ['password too long (129)', { password: 'x'.repeat(129) }, ['password']],
    ['non-string password', { password: 42 }, ['password']],
    ['name too short (2)', { name: 'ab' }, ['name']],
    ['name too long (25)', { name: 'a'.repeat(25) }, ['name']],
    ['name with a space', { name: 'has space' }, ['name']],
    ['name with a dot', { name: 'with.dot' }, ['name']],
    ['name with non-ASCII letters', { name: 'joão' }, ['name']],
    ['unsupported locale', { locale: 'fr' }, ['locale']],
    ['locale is case-sensitive', { locale: 'pt-br' }, ['locale']],
    ['empty locale', { locale: '' }, ['locale']],
  ])('rejects %s', async (_label, overrides, expectedProperties) => {
    await expect(invalidProperties({ ...VALID, ...overrides })).resolves.toEqual(
      expectedProperties,
    );
  });

  it('rejects a payload missing every required field', async () => {
    await expect(invalidProperties({})).resolves.toEqual(['email', 'name', 'password']);
  });
});
