/**
 * Fight lab (v0.1.3 item 5): ships built from the real part catalog, pirates (today's generator and
 * fixed ones by region) and the real combat resolver, energy included (a shield pays energy for every
 * point it recovers, a laser pays for every shot, the reactors and batteries pay for both).
 */
import { readFileSync } from 'node:fs';
import { createRng } from '../../src/common/rng/rng.js';
import type { GameRules } from '../../src/config/game-config.types.js';
import { pickCatalogStats } from '../../src/parts/parts.service.js';
import { resolveCombat } from '../../src/resolution/combat/combat.resolver.js';
import type { CombatSheet } from '../../src/resolution/combat/combat.types.js';
import { generatePirate } from '../../src/resolution/encounter/pirate.generator.js';
import { startingPools } from '../../src/missions/resolution-input.js';
import { combatEnergyDraw, pierceShare } from '../../src/ships/combat-energy.js';
import { deriveSheet } from '../../src/ships/sheet.deriver.js';
import { checkViability } from '../../src/ships/viability.js';

interface CatalogRow {
  partType: string;
  partClass: string;
  pdf: number;
  esc: number;
  energyCombat: number;
  energyCont: number;
  batOutput: number;
  batCharge: number;
  specialProp: Record<string, unknown> | null;
  [key: string]: unknown;
}

const snapshot = JSON.parse(
  readFileSync(new URL('../../sim-data/snapshot.json', import.meta.url), 'utf8'),
) as { rules: GameRules; catalog: CatalogRow[] };

export const baseRules: GameRules = snapshot.rules;

/** Dials to test a rule change without touching the game: every one is a multiplier (1 = today). */
export interface Dials {
  /** firepower of every weapon */
  weapon: number;
  /** capacity of every shield */
  shieldEsc: number;
  /** shield recovery per round */
  shieldRegen: number;
  /** combat energy drawn by shields and weapons (energyCombat) */
  combatEnergy: number;
  /** combat energy a shield pays for what it recovers (the game's combat.shield_energy_factor) */
  shieldEnergy: number;
  /** output of reactors and batteries */
  supply: number;
}
export const NO_DIALS: Dials = {
  weapon: 1,
  shieldEsc: 1,
  shieldRegen: 1,
  combatEnergy: 1,
  shieldEnergy: 1,
  supply: 1,
};

function adjustedRow(row: CatalogRow, dials: Dials): CatalogRow {
  const next: CatalogRow = { ...row };
  const special = { ...(row.specialProp ?? {}) } as Record<string, unknown>;
  if (row.partClass === 'WEAPON') next.pdf = row.pdf * dials.weapon;
  if (row.esc > 0) {
    next.esc = row.esc * dials.shieldEsc;
    if (typeof special['shieldRegen'] === 'number')
      special['shieldRegen'] = special['shieldRegen'] * dials.shieldRegen;
  }
  if (row.energyCombat !== 0) {
    next.energyCombat =
      row.energyCombat * dials.combatEnergy * (row.esc > 0 ? dials.shieldEnergy : 1);
  }
  if (row.partClass === 'REACTOR' && row.energyCont > 0)
    next.energyCont = row.energyCont * dials.supply;
  if (row.partClass === 'BATTERY') {
    next.batOutput = row.batOutput * dials.supply;
    next.batCharge = row.batCharge * dials.supply;
  }
  next.specialProp = special;
  return next;
}

export interface Fighter {
  readonly name: string;
  readonly note: string;
  readonly combat: CombatSheet;
  readonly summary: string;
  readonly viable: boolean;
}

/** A ship from part types (the bridge, hull, engines and so on count: mobility, structure and energy come from the sheet). */
export function buildFighter(
  name: string,
  note: string,
  partTypes: readonly string[],
  dials: Dials = NO_DIALS,
): Fighter {
  const rules = baseRules;
  const byType = new Map(snapshot.catalog.map((row) => [row.partType, row]));
  const parts = partTypes.map((type, index) => {
    const row = byType.get(type);
    if (row === undefined) throw new Error(`unknown part ${type}`);
    return {
      instance: { id: `${name}-${index}`, partType: type, condition: 100 },
      catalog: pickCatalogStats(adjustedRow(row, dials) as never),
    };
  }) as never[];
  const sheet = deriveSheet(parts, rules);
  const pools = startingPools(
    (parts as Array<{ catalog: unknown }>).map((part) => ({
      condition: 100,
      catalog: part.catalog,
    })) as never,
    rules,
  );
  const draw = combatEnergyDraw(parts);
  const viable = checkViability(sheet, parts, rules).viable;
  const pierce = pierceShare(parts);
  const combat: CombatSheet = {
    pdf: sheet.pdf,
    bli: sheet.bli,
    esc: pools.esc,
    sen: sheet.sen,
    hp: pools.hp,
    mob: sheet.mob,
    armor: pools.armor,
    escMax: pools.esc,
    escRegen: pools.escRegen,
    escRegenEnergy: pools.escRegenEnergy,
    battery: pools.battery,
    energyMode: 'FULL',
    batOutput: sheet.batOutput,
    energyCont: sheet.energyCont,
    weaponEnergyDraw: draw.weaponEnergyDraw,
    // the game multiplies both by combat.shield_energy_factor (escRegenEnergy in startingPools)
    shieldEnergyDraw: draw.shieldEnergyDraw * baseRules.combat.shield_energy_factor,
    ...(pierce > 0 ? { pierceShare: pierce } : {}),
  };
  return {
    name,
    note,
    combat,
    viable,
    summary:
      `firepower ${sheet.pdf.toFixed(0)} armor ${Math.round(pools.armor)} shield ${Math.round(pools.esc)}(+${pools.escRegen.toFixed(0)}) ` +
      `hull ${Math.round(pools.hp)} mob ${sheet.mob.toFixed(1)} sen ${sheet.sen.toFixed(0)} energy ${sheet.energyCont.toFixed(0)}+${sheet.batOutput.toFixed(0)}bat`,
  };
}

export interface Pirate {
  readonly name: string;
  readonly make: (player: CombatSheet, seed: string) => CombatSheet;
}

export function generatedPirate(zone: number): Pirate {
  return {
    name: `today, built from you (zone ${zone})`,
    make: (player, seed) =>
      generatePirate(
        player,
        baseRules,
        createRng(seed),
        baseRules.encounter.pirate_zone_strength[String(zone)],
        1,
      ),
  };
}

/** A fixed pirate: the same stats whatever ship it meets (armor is a pool like the player's; its shield recovers a fifth per round). */
export function fixedPirate(
  name: string,
  hp: number,
  pdf: number,
  bli: number,
  esc: number,
  mob: number,
  sen = 0,
  regenRatio = 0.2,
): Pirate {
  const sheet: CombatSheet = {
    hp,
    pdf,
    bli,
    esc,
    mob,
    sen,
    armor: bli * baseRules.combat.armor_pool_factor,
    escMax: esc,
    escRegen: Math.round(esc * regenRatio),
    escRegenEnergy: 0,
  };
  return { name, make: () => sheet };
}

export interface Tally {
  win: number;
  draw: number;
  loss: number;
  hullLost: number;
  touched: number;
  shieldDown: number;
  fights: number;
}

export function duel(
  ship: Fighter,
  foe: Pirate,
  fights: number,
  rules: GameRules = baseRules,
): Tally {
  const tally: Tally = { win: 0, draw: 0, loss: 0, hullLost: 0, touched: 0, shieldDown: 0, fights };
  for (let i = 0; i < fights; i += 1) {
    const seed = `${ship.name}|${foe.name}|${i}`;
    const rng = createRng(seed);
    const enemy = foe.make(ship.combat, seed);
    const playerIsA = rng.float() < 0.5;
    const result = resolveCombat(
      playerIsA ? ship.combat : enemy,
      playerIsA ? enemy : ship.combat,
      rules.combat,
      rng,
      {
        firstStrikeSide: 'A',
      },
    );
    const outcome =
      result.outcome === 'draw' ? 'draw' : (result.outcome === 'A') === playerIsA ? 'win' : 'loss';
    tally[outcome] += 1;
    const hpLeft = playerIsA ? result.final.hpA : result.final.hpB;
    const escLeft = playerIsA ? result.final.escA : result.final.escB;
    const lost = Math.max(0, ship.combat.hp - hpLeft);
    tally.hullLost += lost / ship.combat.hp;
    if (lost > 0) tally.touched += 1;
    if (ship.combat.esc > 0 && escLeft <= 0) tally.shieldDown += 1;
  }
  return tally;
}

export const pct = (n: number, of: number): string => `${Math.round((100 * n) / of)}%`.padStart(4);
