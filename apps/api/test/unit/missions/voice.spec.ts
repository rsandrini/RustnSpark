import { describe, expect, it } from '@jest/globals';
import {
  fillLine,
  parsePools,
  pickLine,
  voiced,
  type VoiceValues,
} from '../../../src/missions/voice.js';

const VALUES: VoiceValues = {
  en: { destination: 'Hedus Base', reward: '4,500' },
  'pt-BR': { destination: 'Base Hedus', reward: '4.500' },
};
const line = (en: string, pt: string) => ({ en, 'pt-BR': pt });
const FALLBACK = line('template text', 'texto do modelo');

describe('quest giver voice', () => {
  it('fills the placeholders in each language and leaves an unknown one visible', () => {
    expect(
      fillLine(
        line('To {destination} for {reward} {nope}', 'Para {destination}, {reward}'),
        VALUES,
      ),
    ).toEqual({
      en: 'To Hedus Base for 4,500 {nope}',
      'pt-BR': 'Para Base Hedus, 4.500',
    });
  });

  it('picks the same line for the same seed, and spreads across seeds', () => {
    const pools = parsePools({ k: [line('a', 'a'), line('b', 'b'), line('c', 'c')] });
    expect(pickLine(pools, 'k', 'seed1')).toEqual(pickLine(pools, 'k', 'seed1'));
    const seen = new Set<string>();
    for (let i = 0; i < 60; i += 1) seen.add(pickLine(pools, 'k', `s${i}`)?.en ?? '');
    expect(seen.size).toBe(3);
  });

  it('falls back to the template text for a missing pool or a half-written line', () => {
    const pools = parsePools({ k: [line('only english', '  ')] });
    expect(voiced(pools, 'missing', 's', VALUES, FALLBACK)).toEqual(FALLBACK);
    expect(voiced(pools, 'k', 's', VALUES, FALLBACK)).toEqual(FALLBACK);
    expect(
      voiced(
        parsePools({ k: [line('hi {destination}', 'oi {destination}')] }),
        'k',
        's',
        VALUES,
        FALLBACK,
      ),
    ).toEqual({
      en: 'hi Hedus Base',
      'pt-BR': 'oi Base Hedus',
    });
  });

  it('parses Admin-edited pools without throwing', () => {
    expect(parsePools(null)).toEqual({});
    expect(parsePools([1, 2])).toEqual({});
    expect(parsePools({ a: 'x', b: [{ en: 1 }, null, line('ok', 'ok'), line('', 'x')] })).toEqual({
      b: [line('ok', 'ok')],
    });
  });
});
