import { describe, it, expect } from 'vitest';
import { findReplaceCandidate, type InstalledPartForCompare } from './part-compare-match';

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
