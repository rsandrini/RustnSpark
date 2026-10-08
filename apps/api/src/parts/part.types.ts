export interface PartCatalog {
  partType: string;
  partClass: string;
  w: number;
  h: number;
  mass: number;
  structureCost: number;
  partHp: number;
  /** Catalog list price — carried into the dispatch snapshot so resolve can compute shipTier (D29). */
  basePrice: number;
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
  pressurized: boolean;
  lifeSupport: boolean;
  /** Shield parts: points of shield recovered per combat round (paid for with combat energy). */
  shieldRegen?: number;
  /** Weapon/shield/mining rig: power it keeps drawing while idle (0/absent = the default). */
  idlePower?: number;
}

export interface PartInstance {
  id: string;
  partType: string;
  condition: number;
  /** The instance's stored connector layout (null = universal fallback). Optional so callers
      without it (pure geometry tests) skip connector-aware placement. */
  connectors?: unknown;
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

export type LayoutErrorCode =
  | 'OUT_OF_BOUNDS'
  | 'OVERLAP'
  /** An engine has another part beyond its exhaust edge (half-plane). */
  | 'EXHAUST_BLOCKED'
  /** A weapon has another part beyond its firing edge (half-plane). */
  | 'FACING_BLOCKED'
  /** An engine/weapon carries a connector on its facing side. */
  | 'FACING_CONNECTOR';

export interface LayoutError {
  code: LayoutErrorCode;
  partInstanceId?: string;
  message: string;
}
