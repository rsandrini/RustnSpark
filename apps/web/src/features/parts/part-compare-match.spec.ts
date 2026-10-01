import { describe, it, expect } from 'vitest';
import {
  findReplaceCandidate,
  rankReplaceCandidates,
  type InstalledPartForCompare,
} from './part-compare-match';

const name = (en: string): InstalledPartForCompare['displayName'] => ({ en, 'pt-BR': en });

const part = (
  id: string,
  partClass: string,
  w: number,
  h: number,
): InstalledPartForCompare => ({ id, displayName: name(id), catalog: { partClass, w, h } });

describe('findReplaceCandidate', () => {
  it('returns undefined when nothing of the class is installed', () => {
    const installed = [part('bridge-1', 'BRIDGE', 2, 2)];
    const candidate = { catalog: { partClass: 'DEFENSE', w: 2, h: 1 } };
    expect(findReplaceCandidate(installed, candidate)).toBeUndefined();
  });

  it('prefers the same-class part with the same footprint over another same-class part', () => {
    const small = part('cargo-small', 'CARGO', 1, 1);
    const big = part('cargo-big', 'CARGO', 2, 1);
    const candidate = { catalog: { partClass: 'CARGO', w: 2, h: 1 } };
    expect(findReplaceCandidate([small, big], candidate)?.id).toBe('cargo-big');
  });

  it('falls back to the first same-class part when no footprint matches', () => {
    const a = part('cargo-a', 'CARGO', 1, 1);
    const b = part('cargo-b', 'CARGO', 1, 2);
    const candidate = { catalog: { partClass: 'CARGO', w: 3, h: 3 } };
    expect(findReplaceCandidate([a, b], candidate)?.id).toBe('cargo-a');
  });

  it('is deterministic: the same input always returns the same match', () => {
    const installed = [part('cargo-a', 'CARGO', 1, 1), part('cargo-b', 'CARGO', 1, 1)];
    const candidate = { catalog: { partClass: 'CARGO', w: 1, h: 1 } };
    const first = findReplaceCandidate(installed, candidate);
    const second = findReplaceCandidate(installed, candidate);
    expect(first?.id).toBe(second?.id);
  });
});

// Owner request: today's compare auto-picks one installed part to show as a "replace" scenario,
// with no way to see "add it instead" or pick a different one of two same-class parts. The
// picker needs every same-class candidate, not just the one `findReplaceCandidate` would pick.
describe('rankReplaceCandidates', () => {
  it('returns every installed part of the same class, not just one', () => {
    const a = part('shield-a', 'DEFENSE', 1, 1);
    const b = part('shield-b', 'DEFENSE', 1, 1);
    const bridge = part('bridge-1', 'BRIDGE', 2, 2);
    const candidate = { catalog: { partClass: 'DEFENSE', w: 1, h: 1 } };
    const ranked = rankReplaceCandidates([a, b, bridge], candidate);
    expect(ranked.map((p) => p.id)).toEqual(['shield-a', 'shield-b']);
  });

  it('puts the same-footprint match first, same as findReplaceCandidate would pick as the default', () => {
    const small = part('cargo-small', 'CARGO', 1, 1);
    const big = part('cargo-big', 'CARGO', 2, 1);
    const candidate = { catalog: { partClass: 'CARGO', w: 2, h: 1 } };
    const ranked = rankReplaceCandidates([small, big], candidate);
    expect(ranked[0]?.id).toBe('cargo-big');
    expect(ranked.map((p) => p.id)).toEqual(['cargo-big', 'cargo-small']);
  });

  it('returns an empty list when nothing of the class is installed', () => {
    const installed = [part('bridge-1', 'BRIDGE', 2, 2)];
    const candidate = { catalog: { partClass: 'DEFENSE', w: 2, h: 1 } };
    expect(rankReplaceCandidates(installed, candidate)).toEqual([]);
  });
});
