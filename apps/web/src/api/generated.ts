export interface RegisterRequest {
  email: string;
  password: string;
  name: string;
}

export interface RegisterResponse {
  accessToken: string;
  player: PlayerProfileResponse;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  accessToken: string;
}

export interface RefreshResponse {
  accessToken: string;
}

export type LogoutRequest = Record<string, never>;

export type UserRole = 'PLAYER' | 'ADMIN';

export interface PlayerProfileResponse {
  id: string;
  name: string;
  credits: number;
  locale: string;
  role: UserRole;
  /** null until POST /v1/players/me/onboarding picks a faction (S10.2). */
  factionId: string | null;
}

export interface UpdateLocaleRequest {
  locale: string;
}

export interface UpdateLocaleResponse {
  locale: string;
}

export interface AdminPlaceholderResponse {
  message: string;
}

export interface ConfigEntryResponse {
  key: string;
  group: string;
  type: string;
  min: number;
  max: number;
  unit?: string;
  description: { en: string; 'pt-BR': string };
  currentValue: unknown;
  factoryDefault: unknown;
  modified: boolean;
}

export interface UpdateConfigValueRequest {
  value: unknown;
  expectedRevision: number;
  reason: string;
}

export interface ResetConfigValueRequest {
  expectedRevision: number;
  reason: string;
}

export interface TuningRevisionResponse {
  id: string;
  actor: string;
  entityType: string;
  entityId: string;
  before: unknown;
  after: unknown;
  reason: string;
  at: string;
}

export interface BundleExportEntry {
  key: string;
  value: unknown;
  factoryDefault: unknown;
  type: string;
}

export interface BundleExport {
  version: number;
  exportedAt: string;
  entries: BundleExportEntry[];
}

export interface BundleDiff {
  key: string;
  before: unknown;
  after: unknown;
}

export type EntityFieldType =
  'string' | 'integer' | 'float' | 'boolean' | 'json' | 'enum' | 'locale-map';

export interface EntitySchemaField {
  name: string;
  type: EntityFieldType;
  required: boolean;
  enumValues?: string[];
  min?: number;
  max?: number;
  description?: { en: string; 'pt-BR': string };
  configKey?: string;
}

export interface EntitySchemaResponse {
  entity: string;
  fields: EntitySchemaField[];
}

export interface CreateEntityRequest {
  data: Record<string, unknown>;
  reason: string;
}

export interface UpdateEntityRequest {
  data: Record<string, unknown>;
  reason: string;
}

export interface RetireEntityRequest {
  reason: string;
}

export interface EntityChangeResponse {
  row: Record<string, unknown>;
  revision: TuningRevisionResponse;
}

// ---------------------------------------------------------------------------
// Game API (Step 10) — hand-written from the Nest controllers; the repo has no
// OpenAPI pipeline yet (S10.1's regen step is a later wrap-up), so this file
// stays the single typed surface the UI consumes.
// ---------------------------------------------------------------------------

export type MissionType = 'DELIVERY' | 'TRANSPORT' | 'ESCORT' | 'MINING' | 'RESCUE';

export type MissionStatus =
  'AVAILABLE' | 'HELD' | 'ACCEPTED' | 'IN_TRANSIT' | 'RESOLVING' | 'DONE' | 'FAILED' | 'EXPIRED';

export type RiskBand = 'lo' | 'md' | 'hi';

export type Locale = 'en' | 'pt-BR';

export interface LocalizedText {
  en: string;
  'pt-BR': string;
}

export interface WorldLocation {
  id: string;
  displayName: LocalizedText;
  description: LocalizedText;
  type: string;
  x: number;
  y: number;
  zone: number;
  factionId: string;
  isolation: number;
  services: Record<string, unknown>;
  risk: RiskBand;
  missionCount: number;
}

export interface WorldRoute {
  id: string;
  nodeAId: string;
  nodeBId: string;
  distance: number;
  danger: number;
  /** Server-decided hot corridor (D24) — the client holds no threshold. */
  hot: boolean;
}

export interface WorldResponse {
  locations: WorldLocation[];
  routes: WorldRoute[];
}

export interface EligibilityReason {
  code: string;
  message: string;
}

export interface BoardEligibility {
  eligible: boolean;
  reasons: EligibilityReason[];
}

export interface MissionLeg {
  routeId?: string;
  distance: number;
  danger: number;
  zone: number;
  env?: { id?: string; level?: number; fuelMult?: number };
}

export interface MissionInstanceData {
  id: string;
  templateId: string;
  type: MissionType;
  factionId: string;
  originId: string;
  destinationId: string;
  legs: unknown;
  cargo: unknown;
  reward: number;
  expiresAt: string;
  status: MissionStatus;
  playerId: string | null;
  shipId: string | null;
  acceptedAt: string | null;
  arrivalAt: string | null;
  deadlineAt: string | null;
  seed: string;
  version: number;
}

/** GET /v1/locations/:id/missions — board rows carry the estimate and the upfront verdict. */
export interface MissionOffer extends MissionInstanceData {
  rewardEstimate: number;
  eligibility: BoardEligibility;
}

/** GET /v1/missions/active — raw instance plus the in-transit leg windows (empty before dispatch). */
export interface ActiveMission extends MissionInstanceData {
  legWindows: LegWindow[];
}

export interface LegWindow {
  legIndex: number;
  routeId: string;
  from: string;
  to: string;
}

export interface ActiveMission extends MissionOffer {
  legWindows: LegWindow[];
}

export interface DispatchResponse {
  missionId: string;
  arrivalAt: string;
  serverTime: string;
  durationSeconds: number;
  durationClass?: 'fast' | 'medium' | 'slow';
}

export type PartClass =
  | 'ENGINE'
  | 'TANK'
  | 'BATTERY'
  | 'REACTOR'
  | 'WEAPON'
  | 'DEFENSE'
  | 'CARGO'
  | 'SENSOR'
  | 'UTILITY'
  | 'BRIDGE';

export interface PartCatalogStats {
  partType: string;
  partClass: PartClass;
  w: number;
  h: number;
  mass: number;
  structureCost: number;
  partHp: number;
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
}

export interface InventoryItem {
  id: string;
  partType: string;
  condition: number;
  location: 'INVENTORY' | 'INSTALLED';
  shipId: string | null;
  catalog: PartCatalogStats;
}

/** Grid placement: integer cells on the [-10, 10) yard, rotation at right angles only. */
export interface Placement {
  partInstanceId: string;
  gx: number;
  gy: number;
  rot: 0 | 90;
}

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
  structureUsed: number;
  structureBudget: number;
  autonomy: number;
  mob: number;
  condition: number;
}

export type ShipClassType = 'HAULER' | 'TRANSPORT' | 'WARSHIP' | 'MINER' | 'MULTIROLE';

export interface RescueResponse {
  shipId: string;
  status: string;
  cost: number;
  fuel: number;
  credits: number;
  restartParts: string[];
}

export interface ShipResponse {
  id: string;
  ownerPlayerId: string;
  name: string;
  fuel: number;
  status: string;
  currentLocationId: string;
  stance: string;
  layout: Placement[];
  sheet: ShipSheet;
  shipClass: ShipClassType;
}

export type ViabilityProblemCode =
  | 'NO_BRIDGE'
  | 'NO_ENGINE'
  | 'MOB_TOO_LOW'
  | 'NO_FUEL_CAPACITY'
  | 'NO_LIFE_SUPPORT'
  | 'STRUCTURE_EXCEEDED';

export interface Problem {
  code: string;
  message: string;
}

export interface PreviewResponse {
  sheet: ShipSheet;
  shipClass: ShipClassType;
  viability: { viable: boolean; problems: Problem[] };
  layout: Placement[];
  omittedPartInstanceIds: string[];
}

/** Reports (S10.8) — mirrors ReportsService/ViewResult until the OpenAPI pipeline lands. */
export type ReportViewName = 'summary' | 'narrative' | 'log';

export type ReportSegment =
  { t: 'text'; value: string } | { t: 'ref'; kind: 'part' | 'loot'; id: string; value: string };

export interface ReportLine {
  text: string;
  segments: ReportSegment[];
}

export interface MissionDamageCascade {
  shield: number;
  armor: number;
  hp: number;
}

export interface NarrativeLine extends ReportLine {
  detail?: { cascade: MissionDamageCascade };
}

export interface NarrativeChapter {
  leg: number;
  header: ReportLine;
  lines: NarrativeLine[];
}

export type ReportResponse =
  | { locale: string; outcome: string; view: 'summary'; lines: ReportLine[] }
  | { locale: string; outcome: string; view: 'log'; lines: ReportLine[] }
  | { locale: string; outcome: string; view: 'narrative'; chapters: NarrativeChapter[] };

export interface ReportListItem {
  missionId: string;
  outcome: string;
  credits: number;
  legs: number;
  createdAt: string;
}

export interface ReportListResponse {
  items: ReportListItem[];
  nextCursor?: string;
}

/** Economy (S10.9) — mirrors the economy services until the OpenAPI pipeline lands. */
export interface MarketListing {
  listingId: string;
  kind: 'catalog' | 'used';
  partType: string;
  partClass: string;
  displayName: LocalizedText;
  condition: number;
  price: number;
}

/** What the port pays for one of the player's inventory parts (server-quoted). */
export interface SellOffer {
  partInstanceId: string;
  price: number;
}

export interface MarketResponse {
  locationId: string;
  listings: MarketListing[];
  sellOffers: SellOffer[];
}

export interface BuyResponse {
  partInstanceId: string;
  partType: string;
  condition: number;
  price: number;
  credits: number;
}

export interface SellResponse {
  partInstanceId: string;
  price: number;
  credits: number;
}

export interface MaterialHolding {
  materialId: string;
  displayName: LocalizedText;
  rarity: string;
  quantity: number;
  unitPrice: number;
}

export interface MaterialsResponse {
  locationId: string;
  materials: MaterialHolding[];
}

export interface SellMaterialResponse {
  materialId: string;
  quantity: number;
  price: number;
  credits: number;
}

export interface RefuelResponse {
  shipId: string;
  units: number;
  cost: number;
  fuel: number;
  fuelCap: number;
  credits: number;
}

export interface RepairQuoteResponse {
  shipId: string;
  cost: number;
  durationSeconds: number;
}

export interface RepairStartResponse {
  repairJobId: string;
  shipId: string;
  cost: number;
  durationSeconds: number;
  completesAt: string;
  targets: { partInstanceId: string; fromCondition: number; toCondition: number }[];
}

export interface ScavengeResponse {
  locationId: string;
  attempt: number;
  fieldType: 'common' | 'mission' | 'pirate';
  dropped: boolean;
  part: {
    partInstanceId: string;
    partType: string;
    displayName: LocalizedText;
    condition: number;
  } | null;
  cooldownSeconds: number;
}
