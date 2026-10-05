import { describe, expect, it } from '@jest/globals';
import { PARTS } from '../../../prisma/seed-data/parts.js';

// A part the player cannot understand is a defect (playtest, 2026-09-26): every catalog part
// ships a real description in both languages, long enough to say what it does and why.
describe('part catalog descriptions', () => {
  it.each(PARTS.map((part) => [part.partType, part] as const))(
    '%s explains itself in en and pt-BR',
    (_partType, part) => {
      for (const locale of ['en', 'pt-BR'] as const) {
        const text = part.description[locale];
        expect(text.length).toBeGreaterThanOrEqual(60);
        expect(text.trim().endsWith('.')).toBe(true);
      }
      expect(part.description['pt-BR']).not.toBe(part.description.en);
    },
  );
});
