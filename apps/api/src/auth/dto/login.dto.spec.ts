import { describe, expect, it } from '@jest/globals';
import { validate } from 'class-validator';
import { LoginDto } from './login.dto.js';

async function invalidProperties(payload: Record<string, unknown>): Promise<string[]> {
  const dto = Object.assign(new LoginDto(), payload);
  const errors = await validate(dto);
  return errors.map((error) => error.property).sort();
}

const VALID: Record<string, unknown> = {
  email: 'pilot@example.com',
  password: 'correct-horse-1',
};

describe('LoginDto validation', () => {
  it('accepts a valid payload', async () => {
    await expect(invalidProperties(VALID)).resolves.toEqual([]);
  });

  it.each([
    ['malformed email', { email: 'not-an-email' }, ['email']],
    ['password too short (9)', { password: 'x'.repeat(9) }, ['password']],
    ['password too long (129)', { password: 'x'.repeat(129) }, ['password']],
  ])('rejects %s', async (_label, overrides, expectedProperties) => {
    await expect(invalidProperties({ ...VALID, ...overrides })).resolves.toEqual(
      expectedProperties,
    );
  });

  it('rejects a payload missing every required field', async () => {
    await expect(invalidProperties({})).resolves.toEqual(['email', 'password']);
  });
});
