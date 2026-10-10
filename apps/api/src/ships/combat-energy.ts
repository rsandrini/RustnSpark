import type { InstalledPart } from '../parts/part.types.js';

export interface CombatEnergyDraw {
  readonly weaponEnergyDraw: number;
  readonly shieldEnergyDraw: number;
}

/**
 * Splits a ship's total `energyCombat` draw into weapon and shield portions.
 * Weapons (partClass WEAPON) always count toward weapon draw. DEFENSE parts
 * with a negative `energyCombat` are treated as shields/armor with an energy
 * cost — only those that actually absorb damage pay the shield draw.
 */
export function combatEnergyDraw(parts: InstalledPart[]): CombatEnergyDraw {
  let weaponEnergyDraw = 0;
  let shieldEnergyDraw = 0;
  for (const part of parts) {
    const draw = Math.abs(part.catalog.energyCombat ?? 0);
    if (draw <= 0) {
      continue;
    }
    if (part.catalog.partClass === 'WEAPON') {
      weaponEnergyDraw += draw;
    } else if (part.catalog.partClass === 'DEFENSE') {
      // Armor has no energyCombat; shields do. This also safely covers any
      // future DEFENSE part with an energy cost that isn't a shield.
      shieldEnergyDraw += draw;
    }
  }
  return { weaponEnergyDraw, shieldEnergyDraw };
}

/**
 * The share (0–1) of a ship's firepower that comes from armor-piercing weapons (lasers): those
 * hits skip the armor's flat cut. Weighted by each weapon's `pdf`; 0 for a ship with none.
 */
export function pierceShare(parts: InstalledPart[]): number {
  let total = 0;
  let piercing = 0;
  for (const part of parts) {
    if (part.catalog.partClass !== 'WEAPON' || part.catalog.pdf <= 0) continue;
    total += part.catalog.pdf;
    if (part.catalog.armorPiercing === true) piercing += part.catalog.pdf;
  }
  return total > 0 ? piercing / total : 0;
}
