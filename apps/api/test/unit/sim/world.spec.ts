import { describe, expect, it } from '@jest/globals';
import {
  boardAt,
  buildFillerWorld,
  createBoard,
  portFactsOf,
  scavengeContextOf,
} from '../../../sim/core/world.js';
import { starterPlayer } from '../../../sim/core/state.js';
import { fixtureSnapshot } from './fixture.js';

const snapshot = fixtureSnapshot();
const rules = snapshot.rules;
const TAKEN_AT_MS = Date.parse(snapshot.takenAt);

function boardInput() {
  const state = starterPlayer(snapshot, 'luna');
  const board = createBoard();
  return { board, state, world: buildFillerWorld(snapshot), rules, snapshot };
}

describe('buildFillerWorld', () => {
  it('keeps only active templates and non-fixed materials', () => {
    const world = buildFillerWorld(snapshot);
    expect(world.templates.map((template) => template.id)).toEqual(['delivery_luna']);
    expect(world.materials.map((material) => material.id)).toEqual(['ore_iron']);
    expect(world.locations).toHaveLength(3);
    expect(world.routes).toHaveLength(3);
  });
});

describe('boardAt', () => {
  it('fills the board to board_min with live, varied offers', () => {
    const input = boardInput();
    const offers = boardAt({ ...input, locationId: 'ceres', nowMs: TAKEN_AT_MS });
    const publicOffers = offers.filter((offer) => !offer.starter);
    expect(publicOffers).toHaveLength(rules.missions.board_min_per_location);
    expect(publicOffers.every((offer) => offer.expiresAtMs > TAKEN_AT_MS)).toBe(true);
    expect(publicOffers.every((offer) => offer.legs.length > 0)).toBe(true);
    expect(publicOffers.every((offer) => offer.type === 'DELIVERY')).toBe(true);
  });

  it('keeps a private starter offer while the player qualifies', () => {
    const input = boardInput();
    const offers = boardAt({ ...input, locationId: 'ceres', nowMs: TAKEN_AT_MS });
    expect(offers[0]?.starter).toBe(true);
    expect(offers[0]?.originId).toBe('ceres');
  });

  it('is deterministic for the same board, clock and location', () => {
    const first = boardAt({ ...boardInput(), locationId: 'ceres', nowMs: TAKEN_AT_MS });
    const second = boardAt({ ...boardInput(), locationId: 'ceres', nowMs: TAKEN_AT_MS });
    expect(first.map((offer) => offer.id)).toEqual(second.map((offer) => offer.id));
  });

  it('lets expired offers drop off the board', () => {
    const input = boardInput();
    boardAt({ ...input, locationId: 'ceres', nowMs: TAKEN_AT_MS });
    const farFuture = TAKEN_AT_MS + 40 * 60 * 1000;
    const offers = boardAt({ ...input, locationId: 'ceres', nowMs: farFuture });
    expect(offers.every((offer) => offer.expiresAtMs > farFuture)).toBe(true);
  });
});

describe('portFactsOf', () => {
  it('reads isolation and the employer relation to the player', () => {
    const facts = portFactsOf(snapshot, 'tycho', 'luna');
    expect(facts.isolation).toBe(0.9);
    expect(facts.zone).toBe(0);
    expect(facts.factionRelation).toBe('neutral');
  });

  it('normalizes an unknown relation to neutral', () => {
    const facts = portFactsOf(snapshot, 'ceres', 'nobody');
    expect(facts.factionRelation).toBe('neutral');
  });
});

describe('scavengeContextOf', () => {
  it('builds the zone, tiers and bridge-free catalog from the snapshot', () => {
    const context = scavengeContextOf(snapshot, 'vesta');
    expect(context.zone).toBe(1);
    expect(context.scrapPlace).toBe(false);
    expect(context.tiers).toEqual([{ tier: 'COMMON', chance: 0.5 }]);
    expect(context.catalog.map((part) => part.partType)).not.toContain('bridge');
  });

  it("carries each part's base price, which the price weighting and the zone cap read", () => {
    const context = scavengeContextOf(snapshot, 'vesta');
    for (const entry of context.catalog) {
      const row = snapshot.catalog.find((part) => part.partType === entry.partType);
      expect(entry.basePrice).toBe(row?.basePrice);
    }
  });
});
