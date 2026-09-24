/**
 * Replay of a Python oracle roll tape (Layer 0). Test support only — never
 * imported by production resolution code.
 *
 * A tape entry is `{ fn, args, value }` where `fn` is the Python `random`
 * method name (`random` | `randint` | `uniform` | `choice`). `choice` args are
 * `{ seq: id }` into a file-level intern table so repeated picks from the same
 * list share one copy.
 *
 * Every draw must match the next entry exactly (function, arguments, value);
 * a mismatch or an undrained tape throws. The Python oracle's stream is flat —
 * `child(label)` returns `this` so nested streams share one cursor.
 */
import type { Rng } from './rng.js';

export type TapeFn = 'random' | 'randint' | 'uniform' | 'choice';

export type TapeArgs = readonly number[] | { readonly seq: number };

export interface TapeEntry {
  readonly fn: TapeFn;
  readonly args: TapeArgs;
  readonly value: unknown;
}

export interface TapeSource {
  readonly seqs: readonly (readonly unknown[])[];
  readonly entries: readonly TapeEntry[];
}

function isChoiceArgs(args: TapeArgs): args is { readonly seq: number } {
  return !Array.isArray(args);
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((item, i) => deepEqual(item, b[i]));
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const aRecord = a as Record<string, unknown>;
    const bRecord = b as Record<string, unknown>;
    const aKeys = Object.keys(aRecord);
    const bKeys = Object.keys(bRecord);
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every((key) => key in bRecord && deepEqual(aRecord[key], bRecord[key]));
  }
  return false;
}

export class ScriptedRng implements Rng {
  private index = 0;

  constructor(
    private readonly entries: readonly TapeEntry[],
    private readonly seqs: readonly (readonly unknown[])[] = [],
    private readonly sourceLabel = 'tape',
  ) {}

  static fromTape(tape: TapeSource, sourceLabel = 'tape'): ScriptedRng {
    return new ScriptedRng(tape.entries, tape.seqs, sourceLabel);
  }

  /** Number of entries still unconsumed. */
  get remaining(): number {
    return this.entries.length - this.index;
  }

  /** Throws if any tape entry was never drawn (call-order mismatch). */
  assertDrained(): void {
    if (this.index !== this.entries.length) {
      throw new Error(
        `ScriptedRng(${this.sourceLabel}): ${this.entries.length - this.index} tape entry(ies) left undrained ` +
          `(first unconsumed: ${JSON.stringify(this.entries[this.index])})`,
      );
    }
  }

  float(): number {
    const entry = this.take('random');
    if (!isChoiceArgs(entry.args) && entry.args.length !== 0) {
      this.fail(entry, 'random() takes no arguments');
    }
    if (typeof entry.value !== 'number' || Number.isNaN(entry.value)) {
      this.fail(entry, 'random() value must be a number');
    }
    return entry.value;
  }

  int(min: number, max: number): number {
    const entry = this.take('randint');
    if (isChoiceArgs(entry.args) || entry.args.length !== 2) {
      this.fail(entry, 'randint expects args [min, max]');
    }
    const [entryMin, entryMax] = entry.args;
    if (entryMin !== min || entryMax !== max) {
      this.fail(
        entry,
        `randint args mismatch: tape [${entryMin}, ${entryMax}] vs call [${min}, ${max}]`,
      );
    }
    if (typeof entry.value !== 'number' || !Number.isInteger(entry.value)) {
      this.fail(entry, 'randint value must be an integer');
    }
    if (entry.value < min || entry.value > max) {
      this.fail(entry, `randint value ${entry.value} outside [${min}, ${max}]`);
    }
    return entry.value;
  }

  uniform(min: number, max: number): number {
    const entry = this.take('uniform');
    if (isChoiceArgs(entry.args) || entry.args.length !== 2) {
      this.fail(entry, 'uniform expects args [min, max]');
    }
    const [entryMin, entryMax] = entry.args;
    if (entryMin !== min || entryMax !== max) {
      this.fail(
        entry,
        `uniform args mismatch: tape [${entryMin}, ${entryMax}] vs call [${min}, ${max}]`,
      );
    }
    if (typeof entry.value !== 'number' || Number.isNaN(entry.value)) {
      this.fail(entry, 'uniform value must be a number');
    }
    if (entry.value < min || entry.value >= max) {
      // Python's random.uniform may return max on the closed interval edge; accept both.
      if (entry.value > max || entry.value < min) {
        this.fail(entry, `uniform value ${entry.value} outside [${min}, ${max}]`);
      }
    }
    return entry.value;
  }

  pick<T>(items: readonly T[]): T {
    const entry = this.take('choice');
    if (!isChoiceArgs(entry.args)) {
      this.fail(entry, 'choice expects args { seq }');
    }
    const seqId = entry.args.seq;
    const seq = this.seqs[seqId];
    if (seq === undefined) {
      this.fail(entry, `choice seq id ${seqId} is not in the file-level seqs table`);
    }
    if (!deepEqual(seq, items)) {
      this.fail(entry, `choice sequence mismatch at seq ${seqId}`);
    }
    const matchIndex = seq.findIndex((item) => deepEqual(item, entry.value));
    if (matchIndex === -1) {
      this.fail(entry, 'choice value is not an element of the recorded sequence');
    }
    return items[matchIndex] as T;
  }

  child(label: string): Rng {
    // The Python oracle records one flat stream; child streams share the cursor
    // so a ported life/combat harness never forks the tape. Label is ignored.
    void label;
    return this;
  }

  private take(fn: TapeFn): TapeEntry {
    if (this.index >= this.entries.length) {
      throw new Error(
        `ScriptedRng(${this.sourceLabel}): unexpected ${fn}() — tape exhausted after ${this.entries.length} entries`,
      );
    }
    const entry = this.entries[this.index]!;
    this.index += 1;
    if (entry.fn !== fn) {
      this.fail(entry, `call-order mismatch: expected ${entry.fn}(), got ${fn}()`);
    }
    return entry;
  }

  private fail(entry: TapeEntry, message: string): never {
    // Rewind so the failed entry stays visible to the caller / debugger.
    this.index -= 1;
    throw new Error(
      `ScriptedRng(${this.sourceLabel}): ${message} (entry ${JSON.stringify(entry)})`,
    );
  }
}
