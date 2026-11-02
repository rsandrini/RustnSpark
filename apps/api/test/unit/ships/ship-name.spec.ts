import { describe, expect, it } from '@jest/globals';
import {
  containsBlockedWord,
  isValidSuffix,
  shipNamePrefix,
  tidySuffix,
} from '../../../src/ships/ship-name.js';

describe('ship names', () => {
  it('has a fixed prefix of three letters of the faction, or dashes with none', () => {
    expect(shipNamePrefix('luna')).toBe('LUN-');
    expect(shipNamePrefix('explorers')).toBe('EXP-');
    expect(shipNamePrefix(null)).toBe('----');
  });

  it('tidies spacing and accepts 3 to 20 letters, digits, spaces, hyphens and underscores', () => {
    expect(tidySuffix('  Star   Wind  ')).toBe('Star Wind');
    for (const ok of ['Wren', 'Star Wind', 'Ünal-7', 'a_b', 'x'.repeat(20)]) {
      expect(isValidSuffix(ok)).toBe(true);
    }
    for (const bad of ['ab', 'x'.repeat(21), '-Wren', 'Wren_', 'Wren!', '<b>x</b>', 'a  b', '']) {
      expect(isValidSuffix(bad)).toBe(false);
    }
  });

  it('blocks listed words through case, accents, spacing and digits for letters', () => {
    const list = ['caralho', 'puta', 'fuck'];
    expect(containsBlockedWord('CARALHO', list)).toBe(true);
    expect(containsBlockedWord('c4r a-lh0', list)).toBe(true);
    expect(containsBlockedWord('Fück you', list)).toBe(true);
    expect(containsBlockedWord('Putaria', list)).toBe(true);
  });

  it('lets innocent words through (a short listed word only matches the start of a word)', () => {
    const list = ['puta', 'rape', 'caralho'];
    expect(containsBlockedWord('Computador', list)).toBe(false);
    expect(containsBlockedWord('Grape Star', list)).toBe(false);
    expect(containsBlockedWord('Wren', list)).toBe(false);
    expect(containsBlockedWord('anything', [])).toBe(false);
  });
});
