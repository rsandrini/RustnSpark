// Factory defaults for the onboarding keys (D31). These constants are consumed by
// game-config.ts when seeding GameConfig; the running game reads them from GameRules.
export const STARTER_PARTS: readonly string[] = [
  'bridge',
  'engine_chem_small',
  'tank_small',
  'battery_small',
  'cargo',
  'cargo',
  'hull',
];

export const HOME_LOCATIONS: Readonly<Record<string, string>> = {
  luna: 'ceres',
  sun: 'hedus',
  explorers: 'cair',
};
