import { describe, expect, it } from '@jest/globals';
import { withPoolSize } from '../../../src/prisma/prisma.service.js';

describe('withPoolSize', () => {
  it('adds a pool size to a bare URL', () => {
    expect(withPoolSize('postgresql://u:p@db:5432/app')).toBe(
      'postgresql://u:p@db:5432/app?connection_limit=20',
    );
  });

  it('appends to an existing query string', () => {
    expect(withPoolSize('postgresql://u:p@db:5432/app?schema=public')).toBe(
      'postgresql://u:p@db:5432/app?schema=public&connection_limit=20',
    );
  });

  it('leaves an explicit pool size alone', () => {
    const url = 'postgresql://u:p@db:5432/app?connection_limit=3';
    expect(withPoolSize(url)).toBe(url);
  });
});
