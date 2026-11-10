/**
 * Tunes the fixed pirate ladder: for each pirate tier it searches stats (hull, firepower, armor, shield, mobility)
 * so that the ships of the right level win in a band and the ones below it do not. Prints the best candidates.
 *
 *   npx tsx sim/combat/tune.ts [--tries 250] [--fights 120] [--shield-energy 3] [--tier 4]
 */
import { createRng } from '../../src/common/rng/rng.js';
import { ladder } from './ladder.js';
import { duel, fixedPirate, type Dials, type Fighter, NO_DIALS } from './lib.js';

function flag(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? (process.argv[index + 1] ?? fallback) : fallback;
}
const tries = Number(flag('tries', '250'));
const fights = Number(flag('fights', '120'));
const dials: Dials = { ...NO_DIALS, shieldEnergy: Number(flag('shield-energy', '1')) };
const only = flag('tier', '');
const ships = new Map(ladder(dials).map((ship) => [ship.name.split(' ')[0]!, ship]));
const F = (id: string): Fighter => ships.get(id)!;

// [ship, minimum win, maximum win] per pirate tier. A win is the only good outcome: draws (nobody can hurt the
// other) are penalised too, they make a dull fight.
const TARGETS: Record<number, Array<[Fighter, number, number]>> = {
  0: [[F('F1'), 0.9, 1]],
  1: [
    [F('F1'), 0.6, 0.8],
    [F('F2'), 0.75, 0.92],
    [F('F3'), 0.97, 1],
  ],
  2: [
    [F('F2'), 0, 0.15],
    [F('F3'), 0.4, 0.65],
    [F('F4'), 0.85, 0.97],
    [F('F5'), 0.95, 1],
  ],
  3: [
    [F('F3'), 0, 0.15],
    [F('F4'), 0.55, 0.75],
    [F('F5'), 0.8, 0.95],
    [F('F6'), 0.95, 1],
  ],
  4: [
    [F('F4'), 0.15, 0.35],
    [F('F5'), 0.55, 0.75],
    [F('F6'), 0.8, 0.95],
    [F('F7'), 0.95, 1],
  ],
  5: [
    [F('F4'), 0, 0.08],
    [F('F5'), 0, 0.25],
    [F('F6'), 0.4, 0.6],
    [F('F7'), 0.6, 0.8],
    [F('F8'), 0.9, 1],
  ],
  6: [
    [F('F6'), 0, 0.1],
    [F('F7'), 0.25, 0.45],
    [F('F8'), 0.6, 0.8],
    [F('F9'), 0.9, 1],
  ],
  7: [
    [F('F7'), 0, 0.1],
    [F('F8'), 0.25, 0.45],
    [F('F9'), 0.6, 0.8],
  ],
  8: [
    [F('F8'), 0, 0.1],
    [F('F9'), 0.3, 0.5],
  ],
};
// search ranges per tier: [hull, firepower, armor, shield, mobility, shield recovery per round as a share of the shield x100]
const RANGE: Record<number, number[][]> = {
  0: [
    [30, 70],
    [1, 3],
    [0, 0],
    [0, 0],
    [1, 3],
    [20, 20],
  ],
  1: [
    [60, 130],
    [2, 4],
    [0, 2],
    [0, 10],
    [2, 4],
    [20, 20],
  ],
  2: [
    [150, 300],
    [3, 7],
    [0, 2],
    [10, 30],
    [3, 6],
    [20, 20],
  ],
  3: [
    [300, 500],
    [5, 9],
    [0, 3],
    [15, 40],
    [4, 8],
    [20, 20],
  ],
  4: [
    [450, 700],
    [7, 12],
    [0, 4],
    [20, 50],
    [5, 9],
    [15, 20],
  ],
  5: [
    [500, 900],
    [9, 16],
    [1, 6],
    [25, 70],
    [6, 10],
    [10, 20],
  ],
  6: [
    [700, 1200],
    [12, 26],
    [2, 8],
    [30, 120],
    [6, 10],
    [4, 15],
  ],
  7: [
    [1000, 1800],
    [18, 40],
    [4, 12],
    [60, 180],
    [6, 10],
    [3, 12],
  ],
  8: [
    [1600, 2800],
    [30, 70],
    [6, 18],
    [100, 300],
    [6, 10],
    [2, 10],
  ],
};

const rng = createRng('tune');
const pick = ([lo, hi]: number[]): number => Math.round(lo! + rng.float() * (hi! - lo!));

for (const tier of Object.keys(TARGETS).map(Number)) {
  if (only !== '' && Number(only) !== tier) continue;
  const found: Array<{ miss: number; cfg: number[]; detail: string }> = [];
  for (let attempt = 0; attempt < tries; attempt += 1) {
    const cfg = RANGE[tier]!.map(pick);
    const foe = fixedPirate(
      `P${tier}`,
      cfg[0]!,
      cfg[1]!,
      cfg[2]!,
      cfg[3]!,
      cfg[4]!,
      Math.min(5, tier),
    );
    let miss = 0;
    const detail: string[] = [];
    for (const [ship, lo, hi] of TARGETS[tier]!) {
      const t = duel(ship, foe, fights);
      const win = t.win / fights;
      const draw = t.draw / fights;
      miss += (win < lo ? lo - win : win > hi ? win - hi : 0) + Math.max(0, draw - 0.3);
      detail.push(
        `${ship.name.split(' ')[0]} ${Math.round(win * 100)}%${draw > 0.05 ? `(d${Math.round(draw * 100)})` : ''}`,
      );
    }
    found.push({ miss, cfg, detail: detail.join('  ') });
  }
  found.sort((a, b) => a.miss - b.miss);
  console.log(`\nP${tier}: hull / firepower / armor / shield / mobility / regen%`);
  for (const entry of found.slice(0, 3)) {
    console.log(
      `   ${entry.cfg.join(' / ').padEnd(28)} ${entry.detail}   miss ${entry.miss.toFixed(2)}`,
    );
  }
}
