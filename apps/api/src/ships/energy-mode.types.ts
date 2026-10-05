export type EnergyMode = 'BATTERY' | 'FULL' | 'OVERRIDE';

export const ENERGY_MODES: readonly EnergyMode[] = ['BATTERY', 'FULL', 'OVERRIDE'];

export function isEnergyMode(value: unknown): value is EnergyMode {
  return typeof value === 'string' && (ENERGY_MODES as readonly string[]).includes(value);
}

export const DEFAULT_ENERGY_MODE: EnergyMode = 'FULL';
