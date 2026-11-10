import { MissionOfferSchema, WorldResponseSchema } from '@rustandspark/contract';
import { describe, expect, it } from 'vitest';
import { computePortMarks } from '../hangar/connectors';
import { directionViolations, placementIssue } from '../hangar/hangar.geometry';
import {
  PROLOGUE_CARGO,
  PROLOGUE_CELLS,
  PROLOGUE_ENGINE,
  PROLOGUE_SHIP_START,
  PROLOGUE_SHIP_WITH_CARGO,
  PROLOGUE_SHIP_WITH_ENGINE,
  PROLOGUE_START_PARTS,
  PROLOGUE_WORLD,
  prologueOffers,
  prologueShip,
  type ProloguePart,
} from './prologue-fixtures';

const cells = new Set(PROLOGUE_CELLS.map(([x, y]) => `${x},${y}`));
const PAYOUTS = [600, 900, 1500];

/** The ship's own ports once `part` sits at `gx, gy, rot` beside the starting parts. */
function marksWith(part: ProloguePart, gx: number, gy: number, rot: 0 | 90 | 180 | 270) {
  const ship = prologueShip(PROLOGUE_START_PARTS);
  const layout = [...ship.layout, { partInstanceId: part.id, gx, gy, rot }];
  const catalogById = new Map([...ship.catalogById, [part.id, part.catalog]]);
  const connectorsById = new Map([...ship.connectorsById, [part.id, part.connectors]]);
  return {
    layout,
    catalogById,
    marks: computePortMarks(layout, catalogById, connectorsById).filter(
      (mark) => mark.partInstanceId === part.id,
    ),
  };
}

describe('the opening ship', () => {
  it('starts without an engine and gets one from the friend', () => {
    const classes = (ship: typeof PROLOGUE_SHIP_START) =>
      [...ship.catalogById.values()].map((catalog) => catalog.partClass);
    expect(classes(PROLOGUE_SHIP_START)).not.toContain('ENGINE');
    expect(classes(PROLOGUE_SHIP_WITH_ENGINE)).toContain('ENGINE');
    expect(classes(PROLOGUE_SHIP_WITH_CARGO)).toContain('CARGO');
  });

  it('keeps every starting part inside the format and clear of the others', () => {
    for (const part of PROLOGUE_START_PARTS) {
      const others = PROLOGUE_SHIP_START.layout.filter((p) => p.partInstanceId !== part.id);
      expect(
        placementIssue(
          others,
          PROLOGUE_SHIP_START.catalogById,
          part.id,
          part.target.gx,
          part.target.gy,
          part.target.rot,
          cells,
        ),
      ).toBeNull();
    }
  });

  it('connects the engine at its target spot, with the exhaust clear', () => {
    const { layout, catalogById, marks } = marksWith(
      PROLOGUE_ENGINE,
      PROLOGUE_ENGINE.target.gx,
      PROLOGUE_ENGINE.target.gy,
      PROLOGUE_ENGINE.target.rot,
    );
    expect(marks.map((mark) => mark.state)).toEqual(['connected']);
    expect(directionViolations(layout, catalogById)).toEqual([]);
  });

  it('does not connect the engine turned the wrong way', () => {
    const { layout, catalogById, marks } = marksWith(
      PROLOGUE_ENGINE,
      PROLOGUE_ENGINE.target.gx,
      PROLOGUE_ENGINE.target.gy,
      180,
    );
    const rejected =
      marks.every((mark) => mark.state !== 'connected') ||
      directionViolations(layout, catalogById).length > 0;
    expect(rejected).toBe(true);
  });

  it('does not connect the engine away from the hull', () => {
    const { marks } = marksWith(PROLOGUE_ENGINE, -4, -1, 0);
    expect(marks.every((mark) => mark.state !== 'connected')).toBe(true);
  });

  it.each([0, 90, 180, 270] as const)(
    'connects the cargo hold at its target with turn %i',
    (rot) => {
      const { marks } = marksWith(
        PROLOGUE_CARGO,
        PROLOGUE_CARGO.target.gx,
        PROLOGUE_CARGO.target.gy,
        rot,
      );
      expect(marks.some((mark) => mark.state === 'connected')).toBe(true);
    },
  );
});

describe('the opening world and offers', () => {
  it('has a world and offers in the shapes the screens read', () => {
    expect(() => WorldResponseSchema.parse(PROLOGUE_WORLD)).not.toThrow();
    const offers = prologueOffers(PAYOUTS);
    for (const offer of [offers.race, ...offers.firstStop, ...offers.secondStop, offers.finalRun]) {
      expect(() => MissionOfferSchema.parse(offer)).not.toThrow();
    }
  });

  it('pays the same for both offers of a stop, so the choice never changes the money', () => {
    const offers = prologueOffers(PAYOUTS);
    expect(offers.firstStop[0].reward).toBe(offers.firstStop[1].reward);
    expect(offers.secondStop[0].reward).toBe(offers.secondStop[1].reward);
  });

  it('pays what the server says: the three payouts add up to the credits a pilot starts with', () => {
    const offers = prologueOffers(PAYOUTS);
    const earned = offers.race.reward + offers.firstStop[0].reward + offers.secondStop[0].reward;
    expect(earned).toBe(PAYOUTS.reduce((sum, payout) => sum + payout, 0));
  });

  it('makes the final run the only dangerous one', () => {
    const offers = prologueOffers(PAYOUTS);
    expect(offers.finalRun.info.peakDanger).toBeGreaterThan(0);
    for (const offer of [offers.race, ...offers.firstStop, ...offers.secondStop]) {
      expect(offer.info.peakDanger).toBe(0);
    }
  });

  it('gives the race a friend who finishes ahead of the player', () => {
    const { race } = prologueOffers(PAYOUTS).race.info;
    expect(race?.rivals[0]?.durationSeconds).toBeLessThan(race?.you?.durationSeconds ?? 0);
  });
});
