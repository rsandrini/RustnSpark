import type { GameRules } from '../config/game-config.types.js';
import type { InstalledPart } from '../parts/part.types.js';

export type ShipClassType = 'HAULER' | 'TRANSPORT' | 'WARSHIP' | 'MINER' | 'MULTIROLE';

export function deriveShipClass(parts: InstalledPart[], rules: GameRules): ShipClassType {
  const bridge = parts.find((part) => part.catalog.partClass === 'BRIDGE');
  const budget = bridge === undefined ? 0 : Math.abs(bridge.catalog.structureCost);
  if (budget <= 0) {
    return 'MULTIROLE';
  }

  const cargoCost = structureCostForClasses(parts, ['CARGO']);
  const pressurizedCost = structureCostForFlag(parts, (part) => part.catalog.pressurized);
  const combatCost = structureCostForClasses(parts, ['WEAPON', 'DEFENSE']);
  const hasMiningGear = parts.some((part) => part.catalog.min > 0);

  const cargoShare = cargoCost / budget;
  const combatShare = combatCost / budget;

  if (cargoShare >= rules.ship_class.cargo_share) {
    return 'HAULER';
  }
  if (pressurizedCost > 0 && pressurizedCost / budget >= rules.ship_class.pressurized_share) {
    return 'TRANSPORT';
  }
  if (combatShare >= rules.ship_class.combat_share) {
    return 'WARSHIP';
  }
  if (hasMiningGear) {
    return 'MINER';
  }
  return 'MULTIROLE';
}

function structureCostForClasses(parts: InstalledPart[], classes: readonly string[]): number {
  return parts
    .filter((part) => classes.includes(part.catalog.partClass))
    .reduce((total, part) => total + part.catalog.structureCost, 0);
}

function structureCostForFlag(
  parts: InstalledPart[],
  predicate: (part: InstalledPart) => boolean,
): number {
  return parts.filter(predicate).reduce((total, part) => total + part.catalog.structureCost, 0);
}
