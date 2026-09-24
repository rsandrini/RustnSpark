import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@jest/globals';
import {
  ScriptedRng,
  type TapeEntry,
  type TapeSource,
} from '../../../../src/common/rng/scripted.rng.js';

const oracleDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../fixtures/oracle',
);

interface CombatTapesFixture {
  seqs: TapeSource['seqs'];
  tapes: { entries: TapeEntry[]; outcome: string; seed: number }[];
}

interface LifeTapesFixture {
  seqs: TapeSource['seqs'];
  lives: { entries: TapeEntry[]; seed: number; config: string }[];
}

function entry(fn: TapeEntry['fn'], args: TapeEntry['args'], value: unknown): TapeEntry {
  return { fn, args, value };
}

function replayAll(
  rng: ScriptedRng,
  entries: readonly TapeEntry[],
  seqs: TapeSource['seqs'],
): void {
  for (const e of entries) {
    if (e.fn === 'random') {
      expect(rng.float()).toBe(e.value);
    } else if (e.fn === 'randint') {
      const [min, max] = e.args as [number, number];
      expect(rng.int(min, max)).toBe(e.value);
    } else if (e.fn === 'uniform') {
      const [min, max] = e.args as [number, number];
      expect(rng.uniform(min, max)).toBe(e.value);
    } else {
      const seqId = (e.args as { seq: number }).seq;
      const seq = seqs[seqId] as unknown[];
      expect(rng.pick(seq)).toEqual(e.value);
    }
  }
}

describe('ScriptedRng', () => {
  it('replays a synthetic stream in order and reports drained', () => {
    const rng = new ScriptedRng(
      [
        entry('random', [], 0.25),
        entry('randint', [1, 20], 7),
        entry('uniform', [3, 5], 4.125),
        entry('choice', { seq: 0 }, 'beta'),
      ],
      [['alpha', 'beta', 'gamma']],
      'synthetic',
    );
    expect(rng.float()).toBe(0.25);
    expect(rng.int(1, 20)).toBe(7);
    expect(rng.uniform(3, 5)).toBe(4.125);
    expect(rng.pick(['alpha', 'beta', 'gamma'])).toBe('beta');
    expect(() => rng.assertDrained()).not.toThrow();
  });

  it('throws on call-order mismatch', () => {
    const rng = new ScriptedRng([entry('randint', [1, 6], 3)], [], 'order');
    expect(() => rng.float()).toThrow(/call-order mismatch/);
  });

  it('throws on argument mismatch', () => {
    const rng = new ScriptedRng([entry('randint', [1, 20], 5)], [], 'args');
    expect(() => rng.int(1, 6)).toThrow(/mismatch/);
  });

  it('throws on choice sequence mismatch', () => {
    const rng = new ScriptedRng([entry('choice', { seq: 0 }, 'x')], [['x', 'y']], 'choice');
    expect(() => rng.pick(['a', 'b'])).toThrow(/sequence/);
  });

  it('throws when the choice value is not in the sequence', () => {
    const rng = new ScriptedRng([entry('choice', { seq: 0 }, 'z')], [['x', 'y']], 'choice-value');
    expect(() => rng.pick(['x', 'y'])).toThrow(/not an element/);
  });

  it('throws on leftover tape via assertDrained', () => {
    const rng = new ScriptedRng(
      [entry('random', [], 0.1), entry('random', [], 0.9)],
      [],
      'leftover',
    );
    expect(rng.float()).toBe(0.1);
    expect(() => rng.assertDrained()).toThrow(/left undrained/);
  });

  it('throws when the tape is exhausted early', () => {
    const rng = new ScriptedRng([entry('random', [], 0.1)], [], 'short');
    rng.float();
    expect(() => rng.float()).toThrow(/exhausted/);
  });

  it('child() shares the same cursor (flat Python stream)', () => {
    const rng = new ScriptedRng(
      [entry('random', [], 0.5), entry('randint', [0, 1], 1)],
      [],
      'child',
    );
    const child = rng.child('leg:0');
    expect(child.float()).toBe(0.5);
    expect(child.int(0, 1)).toBe(1);
    expect(() => rng.assertDrained()).not.toThrow();
  });

  it('replays real combat tapes entry-by-entry without mismatch', () => {
    const fixture = JSON.parse(
      readFileSync(path.join(oracleDir, 'combat-tapes.json'), 'utf8'),
    ) as CombatTapesFixture;
    expect(fixture.tapes.length).toBeGreaterThanOrEqual(500);
    // Sample: full 600-fight Layer-1 replay lands with the combat resolver (S5.3).
    for (const tape of fixture.tapes.slice(0, 10)) {
      const rng = new ScriptedRng(tape.entries, fixture.seqs, `combat seed ${tape.seed}`);
      replayAll(rng, tape.entries, fixture.seqs);
      expect(() => rng.assertDrained()).not.toThrow();
    }
  });

  it('replays a real life tape with file-level interned choice sequences', () => {
    const fixture = JSON.parse(
      readFileSync(path.join(oracleDir, 'life-tapes.json'), 'utf8'),
    ) as LifeTapesFixture;
    expect(fixture.lives.length).toBeGreaterThanOrEqual(20);
    for (const life of fixture.lives.slice(0, 3)) {
      const rng = new ScriptedRng(life.entries, fixture.seqs, `life ${life.seed}`);
      replayAll(rng, life.entries, fixture.seqs);
      expect(() => rng.assertDrained()).not.toThrow();
    }
  });
});
