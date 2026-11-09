/**
 * Fight analysis (v0.1.3 item 5): who wins, and what it costs, when a ship fights the pirates the game
 * generates today (built from the player's own sheet) versus FIXED pirates by zone. Uses the real
 * combat resolver and pirate generator, the prod rules (sim-data/snapshot.json) and the ship the pilot
 * had at several points of the prod run (backups/prod-2026-11-09/missionlog.jsonl).
 *
 *   npx tsx sim/combat_analysis.ts [fights-per-case]
 */
import { readFileSync } from 'node:fs';
import { createRng } from '../src/common/rng/rng.js';
import type { GameRules } from '../src/config/game-config.types.js';
import { resolveCombat } from '../src/resolution/combat/combat.resolver.js';
import type { CombatSheet } from '../src/resolution/combat/combat.types.js';
import { generatePirate } from '../src/resolution/encounter/pirate.generator.js';
import { startingPools } from '../src/missions/resolution-input.js';
import { deriveSheet } from '../src/ships/sheet.deriver.js';

const FIGHTS = Number(process.argv[2] ?? 2000);
const rules = (
  JSON.parse(readFileSync(new URL('../sim-data/snapshot.json', import.meta.url), 'utf8')) as {
    rules: GameRules;
  }
).rules;
const rows = readFileSync(
  new URL('../../../backups/prod-2026-11-09/missionlog.jsonl', import.meta.url),
  'utf8',
)
  .trim()
  .split('\n')
  .map(
    (line) =>
      JSON.parse(line) as {
        createdAt: string;
        shipSnapshot: {
          parts: Array<{
            id: string;
            partType: string;
            connected: boolean;
            catalog: Record<string, unknown>;
          }>;
        };
      },
  );

interface Ship {
  readonly label: string;
  readonly sheet: CombatSheet;
  readonly summary: string;
}

function shipAt(index: number, label: string): Ship {
  const parts = rows[index]!.shipSnapshot.parts.filter((part) => part.connected).map((part) => ({
    instance: { id: part.id, partType: part.partType, condition: 100 },
    catalog: part.catalog,
  })) as never[];
  const sheet = deriveSheet(parts, rules);
  const pools = startingPools(
    rows[index]!.shipSnapshot.parts.filter((part) => part.connected).map((part) => ({
      condition: 100,
      catalog: part.catalog,
    })) as never,
    rules,
  );
  return {
    label,
    summary: `pdf ${sheet.pdf} bli ${sheet.bli} shield ${Math.round(pools.esc)} (+${Math.round(pools.escRegen)}/round) armor-pool ${Math.round(pools.armor)} hull ${Math.round(pools.hp)} mob ${sheet.mob.toFixed(1)} sen ${sheet.sen}`,
    sheet: {
      pdf: sheet.pdf,
      bli: sheet.bli,
      esc: pools.esc,
      sen: sheet.sen,
      hp: pools.hp,
      mob: sheet.mob,
      armor: pools.armor,
      escMax: pools.esc,
      escRegen: pools.escRegen,
      escRegenEnergy: 0,
    },
  };
}

// the ship at the start, after the first upgrades (day 2), mid run (day 3) and the last mission
const ships: Ship[] = [
  shipAt(0, 'start'),
  shipAt(Math.min(16, rows.length - 1), 'day 2'),
  shipAt(Math.min(50, rows.length - 1), 'day 3'),
  shipAt(rows.length - 1, 'last (the owner now)'),
];

interface Pirate {
  readonly label: string;
  readonly make: (player: CombatSheet, seed: string) => CombatSheet;
}

const generated = (zone: number): Pirate => ({
  label: `today: built from the player (zone ${zone})`,
  make: (player, seed) =>
    generatePirate(
      player,
      rules,
      createRng(seed),
      rules.encounter.pirate_zone_strength[String(zone)],
      1,
    ),
});
const fixed = (label: string, sheet: CombatSheet): Pirate => ({ label, make: () => sheet });

/** a fixed pirate: the same stats whatever ship it meets (armor is a pool, like the player's) */
function pirate(
  hp: number,
  pdf: number,
  bli: number,
  esc: number,
  mob: number,
  sen = 0,
): CombatSheet {
  return {
    hp,
    pdf,
    bli,
    esc,
    mob,
    sen,
    armor: bli * rules.combat.armor_pool_factor,
    escMax: esc,
    escRegen: Math.round(esc / 5),
    escRegenEnergy: 0,
  };
}

const PIRATES: Pirate[] = [
  generated(3),
  fixed('fixed zone 1 (hp 90, pdf 3, bli 1, no shield, mob 3)', pirate(90, 3, 1, 0, 3)),
  fixed('fixed zone 2 (hp 220, pdf 5, bli 1, shield 20, mob 5)', pirate(220, 5, 1, 20, 5, 1)),
  fixed('fixed zone 3 (hp 400, pdf 6, bli 2, shield 20, mob 6)', pirate(400, 6, 2, 20, 6, 1)),
  fixed('fixed far field (hp 600, pdf 8, bli 0, shield 20, mob 8)', pirate(600, 8, 0, 20, 8, 1)),
  fixed(
    'fixed far field hard (hp 600, pdf 12, bli 2, shield 20, mob 10)',
    pirate(600, 12, 2, 20, 10, 2),
  ),
];

function fight(player: CombatSheet, enemy: CombatSheet, seed: string) {
  const rng = createRng(seed);
  const playerIsA = rng.float() < 0.5;
  const result = resolveCombat(
    playerIsA ? player : enemy,
    playerIsA ? enemy : player,
    rules.combat,
    rng,
    {
      firstStrikeSide: 'A',
    },
  );
  const won =
    result.outcome === 'draw' ? 'draw' : (result.outcome === 'A') === playerIsA ? 'win' : 'loss';
  const hpLeft = playerIsA ? result.final.hpA : result.final.hpB;
  return { won, hullLost: Math.max(0, player.hp - hpLeft), rounds: result.rounds.length };
}

interface Stat {
  readonly win: number;
  readonly hull: number;
}

function stat(ship: Ship, foe: CombatSheet, fights: number, tag: string): Stat {
  let win = 0;
  let hull = 0;
  for (let i = 0; i < fights; i += 1) {
    const result = fight(ship.sheet, foe, `${tag}|${ship.label}|${i}`);
    if (result.won === 'win') win += 1;
    hull += result.hullLost;
  }
  return { win: win / fights, hull: hull / fights / ship.sheet.hp };
}

/** Looks for fixed pirates per zone that give each ship the win rate the zone is meant to give it. */
function sweep(): void {
  const byLabel = new Map(ships.map((ship) => [ship.label, ship]));
  const start = byLabel.get('start')!;
  const day2 = byLabel.get('day 2')!;
  const day3 = byLabel.get('day 3')!;
  const last = byLabel.get('last (the owner now)')!;
  // [ship, wanted win rate range] per zone
  const targets: Record<string, Array<[Ship, number, number]>> = {
    'zone 1': [
      [start, 0.75, 0.9],
      [day2, 0.95, 1],
    ],
    'zone 2': [
      [start, 0, 0.2],
      [day2, 0.55, 0.75],
      [day3, 0.65, 0.85],
      [last, 0.9, 1],
    ],
    'zone 3': [
      [day2, 0, 0.1],
      [day3, 0.15, 0.35],
      [last, 0.55, 0.75],
    ],
    'far field': [
      [day3, 0, 0.05],
      [last, 0.25, 0.45],
    ],
  };
  const grids: Record<
    string,
    { hp: number[]; pdf: number[]; bli: number[]; esc: number[]; mob: number[] }
  > = {
    'zone 1': { hp: [60, 90, 130], pdf: [2, 3, 4], bli: [0, 1], esc: [0, 10], mob: [2, 3, 4] },
    'zone 2': {
      hp: [150, 220, 300],
      pdf: [4, 5, 6, 7],
      bli: [0, 1, 2],
      esc: [10, 20, 30],
      mob: [4, 5, 6],
    },
    'zone 3': {
      hp: [300, 400, 500],
      pdf: [6, 7, 8, 10],
      bli: [0, 2, 4],
      esc: [20, 35, 50],
      mob: [6, 8, 10],
    },
    'far field': {
      hp: [600],
      pdf: [8, 10, 12, 14, 16],
      bli: [0, 2, 4],
      esc: [20, 28, 35],
      mob: [8, 10, 12],
    },
  };
  for (const [zone, wanted] of Object.entries(targets)) {
    if (process.argv[4] !== undefined && process.argv[4] !== zone) continue;
    const grid = grids[zone]!;
    const found: Array<{ score: number; cfg: string; detail: string }> = [];
    for (const hp of grid.hp)
      for (const pdf of grid.pdf)
        for (const bli of grid.bli)
          for (const esc of grid.esc)
            for (const mob of grid.mob) {
              const foe = pirate(hp, pdf, bli, esc, mob, 1);
              let score = 0;
              const detail: string[] = [];
              for (const [ship, lo, hi] of wanted) {
                const result = stat(ship, foe, 150, zone);
                const miss =
                  result.win < lo ? lo - result.win : result.win > hi ? result.win - hi : 0;
                score += miss;
                detail.push(
                  `${ship.label.split(' ')[0]}${ship.label.split(' ')[1] ?? ''} ${Math.round(result.win * 100)}%/${Math.round(result.hull * 100)}`,
                );
              }
              found.push({
                score,
                cfg: `hp ${hp} pdf ${pdf} bli ${bli} shield ${esc} mob ${mob}`,
                detail: detail.join('  '),
              });
            }
    found.sort((a, b) => a.score - b.score);
    console.log(`\n${zone}: best fixed pirates (win % / hull lost % per ship)`);
    for (const entry of found.slice(0, 4))
      console.log(`   ${entry.cfg.padEnd(44)} ${entry.detail}  (miss ${entry.score.toFixed(2)})`);
  }
}

function report(): void {
  console.log(
    `${FIGHTS} fights per case. win / draw (stalemate at the round cap) / loss, average hull lost, fights that touched the hull\n`,
  );
  for (const ship of ships) {
    console.log(`SHIP ${ship.label}: ${ship.summary}`);
    for (const foe of PIRATES) {
      let win = 0;
      let draw = 0;
      let loss = 0;
      let hull = 0;
      let touched = 0;
      for (let i = 0; i < FIGHTS; i += 1) {
        const seed = `${ship.label}|${foe.label}|${i}`;
        const result = fight(ship.sheet, foe.make(ship.sheet, seed), seed);
        if (result.won === 'win') win += 1;
        else if (result.won === 'draw') draw += 1;
        else loss += 1;
        hull += result.hullLost;
        if (result.hullLost > 0) touched += 1;
      }
      const pct = (n: number) => `${Math.round((100 * n) / FIGHTS)}%`.padStart(4);
      console.log(
        `   vs ${foe.label.padEnd(72)} win ${pct(win)}  draw ${pct(draw)}  loss ${pct(loss)}  hull lost ${((hull / FIGHTS / ship.sheet.hp) * 100).toFixed(0).padStart(3)}%  touched ${pct(touched)}`,
      );
    }
    console.log('');
  }
}

if (process.argv[3] === 'sweep') sweep();
else report();
