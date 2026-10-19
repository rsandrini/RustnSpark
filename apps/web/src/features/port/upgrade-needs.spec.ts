import { describe, expect, it } from 'vitest';
import type { PartUpgradeQuoteResponse } from '../../api/generated';
import { firstMissing, readinessOf, upgradeNeeds } from './upgrade-needs';

const scrap = { en: 'Scrap', 'pt-BR': 'Sucata' };
const crystals = { en: 'Rare crystals', 'pt-BR': 'Cristais raros' };
const quote = (
  cost: number,
  materials: Array<{ id: string; have: number; needed: number }> = [],
): PartUpgradeQuoteResponse => ({
  partInstanceId: 'p-1',
  eligible: true,
  cost,
  materials: materials.map((entry) => ({
    materialId: entry.id,
    displayName: entry.id === 'scrap' ? scrap : crystals,
    have: entry.have,
    needed: entry.needed,
  })),
});

describe('upgradeNeeds', () => {
  it('lists the credits first, then each material, with what is missing', () => {
    const needs = upgradeNeeds(quote(660, [{ id: 'scrap', have: 2, needed: 5 }]), 300);
    expect(needs.map((need) => need.id)).toEqual(['credits', 'scrap']);
    expect(needs[0]).toMatchObject({ have: 300, needed: 660, missing: 360, met: false });
    expect(needs[1]).toMatchObject({ have: 2, needed: 5, missing: 3, met: false });
  });

  it('is all met when the wallet and the materials cover it', () => {
    const needs = upgradeNeeds(quote(100, [{ id: 'scrap', have: 5, needed: 5 }]), 100);
    expect(needs.every((need) => need.met && need.missing === 0)).toBe(true);
    expect(firstMissing(needs)).toBeUndefined();
    expect(readinessOf(needs)).toBe('ready');
  });
});

describe('readinessOf and firstMissing', () => {
  it('only credits short: the credits are what is missing', () => {
    const needs = upgradeNeeds(quote(660, [{ id: 'scrap', have: 5, needed: 5 }]), 300);
    expect(readinessOf(needs)).toBe('credits');
    expect(firstMissing(needs)?.id).toBe('credits');
  });

  it('only materials short', () => {
    const needs = upgradeNeeds(quote(100, [{ id: 'scrap', have: 0, needed: 5 }]), 300);
    expect(readinessOf(needs)).toBe('materials');
    expect(firstMissing(needs)?.id).toBe('scrap');
  });

  it('both short: the card counts as missing materials, the credits are named first', () => {
    const needs = upgradeNeeds(
      quote(660, [
        { id: 'scrap', have: 0, needed: 5 },
        { id: 'rare_crystals', have: 0, needed: 2 },
      ]),
      300,
    );
    expect(readinessOf(needs)).toBe('materials');
    expect(firstMissing(needs)?.id).toBe('credits');
  });

  it('a upgrade with no materials (only credits) is ready or short of credits', () => {
    expect(readinessOf(upgradeNeeds(quote(50), 100))).toBe('ready');
    expect(readinessOf(upgradeNeeds(quote(500), 100))).toBe('credits');
  });
});
