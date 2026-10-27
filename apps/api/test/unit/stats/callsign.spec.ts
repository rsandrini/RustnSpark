import { describe, expect, it } from '@jest/globals';
import { callsignOf, CALLSIGN_MAX_OUTPUT_LENGTH } from '../../../src/stats/callsign.js';

describe('callsignOf', () => {
  it('returns the same callsign for the same input', () => {
    const input = {
      factionId: 'lunar',
      playerName: 'Rafael',
      playerId: 'player-123',
    };
    const first = callsignOf(input);
    const second = callsignOf(input);
    expect(second).toBe(first);
  });

  it('can pick a different word for a different player id', () => {
    const a = callsignOf({ factionId: 'lunar', playerName: 'Rafael', playerId: 'player-a' });
    const b = callsignOf({ factionId: 'lunar', playerName: 'Rafael', playerId: 'player-b' });
    expect(a).not.toBe(b);
  });

  it('cuts a long pilot name to 10 characters', () => {
    const callsign = callsignOf({
      factionId: 'lunar',
      playerName: 'VeryLongPilotNameIndeed',
      playerId: 'player-123',
    });
    const namePart = callsign.split('-')[1];
    expect(namePart).toBe('VeryLongPi');
  });

  it('uses --- as the faction tag when there is no faction', () => {
    const callsign = callsignOf({ factionId: null, playerName: 'Rafael', playerId: 'player-123' });
    expect(callsign.startsWith('---')).toBe(true);
  });

  it('keeps the output within the declared maximum length', () => {
    const callsign = callsignOf({
      factionId: 'faction-with-a-very-long-id',
      playerName: 'AnotherVeryLongName',
      playerId: 'player-xyz',
    });
    expect(callsign.length).toBeLessThanOrEqual(CALLSIGN_MAX_OUTPUT_LENGTH);
  });
});
