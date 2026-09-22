import { describe, expect, it } from '@jest/globals';
import { validationPipeOptions } from './validation.config.js';

describe('validationPipeOptions', () => {
  it('strips unknown properties and rejects requests that carry them', () => {
    expect(validationPipeOptions.whitelist).toBe(true);
    expect(validationPipeOptions.forbidNonWhitelisted).toBe(true);
  });

  it('transforms payloads into their DTO instances', () => {
    expect(validationPipeOptions.transform).toBe(true);
  });
});
