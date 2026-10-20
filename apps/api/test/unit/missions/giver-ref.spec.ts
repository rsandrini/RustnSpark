import { describe, expect, it } from '@jest/globals';
import {
  closingLineOf,
  giverRefOf,
  outcomeClass,
  portraitUrlOf,
} from '../../../src/missions/giver-ref.js';

const row = {
  id: 'g',
  name: 'Ines Moura',
  title: { en: 'Dockmaster', 'pt-BR': 'Mestra de Docas' },
  role: 'MENTOR' as const,
  factionId: 'luna',
  art: null,
  lines: {
    'report.success': [{ en: 'Well flown.', 'pt-BR': 'Bem voado.' }],
    'report.failure': [{ en: 'Next time.', 'pt-BR': 'Da próxima vez.' }],
  },
};

describe('quest giver references', () => {
  it('maps the report outcome to success, partial or failure', () => {
    expect(outcomeClass('completed')).toBe('success');
    expect(outcomeClass('adrift')).toBe('failure');
    expect(outcomeClass('defeat_failed')).toBe('failure');
    expect(outcomeClass('partial_loss')).toBe('partial');
  });

  it('serves an uploaded portrait and none otherwise', () => {
    expect(portraitUrlOf({ portrait: 'g-portrait-abc.png' })).toBe('/v1/art/g-portrait-abc.png');
    expect(portraitUrlOf(null)).toBeNull();
    expect(portraitUrlOf({})).toBeNull();
    expect(giverRefOf({ ...row, art: { portrait: 'x.png' } }).portraitUrl).toBe('/v1/art/x.png');
    expect(giverRefOf(row)).toEqual({
      id: 'g',
      name: 'Ines Moura',
      title: row.title,
      role: 'MENTOR',
      factionId: 'luna',
      portraitUrl: null,
    });
  });

  it("closes a mission with the giver's line for how it ended, or says nothing", () => {
    expect(closingLineOf(row, 'completed', 's')).toEqual({
      en: 'Well flown.',
      'pt-BR': 'Bem voado.',
    });
    expect(closingLineOf(row, 'adrift', 's')?.en).toBe('Next time.');
    expect(closingLineOf(row, 'partial_loss', 's')).toBeNull();
  });
});
