export interface PartCatalog {
  partType: string;
  partClass: string;
  w: number;
  h: number;
  mass: number;
  structureCost: number;
  partHp: number;
  pot: number;
  pdf: number;
  bli: number;
  esc: number;
  sen: number;
  crg: number;
  min: number;
  energyCont: number;
  energyCombat: number;
  fuelCap: number;
  fuelUse: number;
  batCharge: number;
  batOutput: number;
  batInput: number;
}

export interface PartInstance {
  id: string;
  partType: string;
  condition: number;
}

export interface InstalledPart {
  instance: PartInstance;
  catalog: PartCatalog;
}

export interface Placement {
  partInstanceId: string;
  gx: number;
  gy: number;
  rot: number;
}

export type LayoutErrorCode = 'OUT_OF_BOUNDS' | 'OVERLAP' | 'DISCONNECTED';

export interface LayoutError {
  code: LayoutErrorCode;
  partInstanceId?: string;
  message: string;
}
