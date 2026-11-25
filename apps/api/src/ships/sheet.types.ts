export interface ShipSheet {
  pot: number;
  pdf: number;
  bli: number;
  esc: number;
  sen: number;
  crg: number;
  min: number;
  hp: number;
  mass: number;
  energyCont: number;
  energyCombat: number;
  batCharge: number;
  batOutput: number;
  batInput: number;
  fuelCap: number;
  fuelUse: number;
  /** Passenger seats aboard (cabins that are not dead). */
  pax: number;
  /** People the life-support modules keep alive (modules that are not dead). */
  lifeCap: number;
  structureUsed: number;
  structureBudget: number;
  autonomy: number;
  mob: number;
  condition: number;
}
