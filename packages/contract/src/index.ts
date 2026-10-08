/**
 * The HTTP contract between the API and the web client — one definition, three consumers:
 *
 *  - the web app derives every request/response TYPE from these schemas (`z.infer`), so a
 *    screen can only read fields that exist here;
 *  - the web's mock server (MSW) builds its bodies `satisfies` those types, so a handler that
 *    drifts from the contract is a compile error, not a green test against a made-up shape;
 *  - the API's contract integration test calls each endpoint for real and `parse`s the answer
 *    with the same schemas, so the contract cannot drift from what the server actually sends.
 *
 * Only shapes live here — no game rules, no defaults, nothing the client could compute. Text
 * that players read is always a `LocalizedText` pair or a machine code, never a sentence.
 */
import { z } from 'zod';

// ---------------------------------------------------------------------------------------------
// Shared building blocks
// ---------------------------------------------------------------------------------------------

export const LocaleSchema = z.enum(['en', 'pt-BR']);
export type Locale = z.infer<typeof LocaleSchema>;

export const LocalizedTextSchema = z.object({ en: z.string(), 'pt-BR': z.string() });
export type LocalizedText = z.infer<typeof LocalizedTextSchema>;

const IsoDate = z.string();
const Json = z.unknown();

// ---------------------------------------------------------------------------------------------
// Auth and player
// ---------------------------------------------------------------------------------------------

export const UserRoleSchema = z.enum(['PLAYER', 'ADMIN']);
export type UserRole = z.infer<typeof UserRoleSchema>;

export const RegisterRequestSchema = z.object({
  email: z.string(),
  password: z.string(),
  name: z.string(),
  locale: z.string().optional(),
});
export type RegisterRequest = z.infer<typeof RegisterRequestSchema>;

export const PlayerProfileResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  credits: z.number(),
  locale: z.string(),
  role: UserRoleSchema,
  /** null until POST /v1/players/me/onboarding picks a faction (S10.2). */
  factionId: z.string().nullable(),
});
export type PlayerProfileResponse = z.infer<typeof PlayerProfileResponseSchema>;

export const RegisterResponseSchema = z.object({
  accessToken: z.string(),
  player: PlayerProfileResponseSchema,
});
export type RegisterResponse = z.infer<typeof RegisterResponseSchema>;

export const LoginRequestSchema = z.object({ email: z.string(), password: z.string() });
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const LoginResponseSchema = z.object({ accessToken: z.string() });
export type LoginResponse = z.infer<typeof LoginResponseSchema>;

export const RefreshResponseSchema = z.object({ accessToken: z.string() });
export type RefreshResponse = z.infer<typeof RefreshResponseSchema>;

export type LogoutRequest = Record<string, never>;

export const UpdateLocaleRequestSchema = z.object({ locale: z.string() });
export type UpdateLocaleRequest = z.infer<typeof UpdateLocaleRequestSchema>;

export const UpdateLocaleResponseSchema = z.object({ locale: z.string() });
export type UpdateLocaleResponse = z.infer<typeof UpdateLocaleResponseSchema>;

// ---------------------------------------------------------------------------------------------
// Ships, parts, assembly
// ---------------------------------------------------------------------------------------------

export const PartClassSchema = z.enum([
  'ENGINE',
  'TANK',
  'BATTERY',
  'REACTOR',
  'WEAPON',
  'DEFENSE',
  'CARGO',
  'SENSOR',
  'UTILITY',
  'BRIDGE',
]);
export type PartClass = z.infer<typeof PartClassSchema>;

export const PartCatalogStatsSchema = z.object({
  partType: z.string(),
  partClass: PartClassSchema,
  w: z.number(),
  h: z.number(),
  mass: z.number(),
  structureCost: z.number(),
  partHp: z.number(),
  basePrice: z.number(),
  pot: z.number(),
  pdf: z.number(),
  bli: z.number(),
  esc: z.number(),
  sen: z.number(),
  crg: z.number(),
  min: z.number(),
  energyCont: z.number(),
  energyCombat: z.number(),
  fuelCap: z.number(),
  fuelUse: z.number(),
  batCharge: z.number(),
  batOutput: z.number(),
  batInput: z.number(),
  pressurized: z.boolean(),
  lifeSupport: z.boolean(),
});
export type PartCatalogStats = z.infer<typeof PartCatalogStatsSchema>;

export const PartLocationSchema = z.enum(['INVENTORY', 'INSTALLED']);

export const ConnectorCellSchema = z.object({
  dx: z.number(),
  dy: z.number(),
  side: z.enum(['N', 'E', 'S', 'W']),
  kind: z.enum(['none', 'central', 'split', 'universal']),
});
export type ConnectorCell = z.infer<typeof ConnectorCellSchema>;

export const InventoryItemSchema = z.object({
  id: z.string(),
  partType: z.string(),
  displayName: LocalizedTextSchema,
  description: LocalizedTextSchema,
  rarity: z.string(),
  condition: z.number(),
  /** Dead: at or below the wear threshold, it counts for nothing until repaired. */
  broken: z.boolean(),
  location: PartLocationSchema,
  shipId: z.string().nullable(),
  catalog: PartCatalogStatsSchema,
  connectors: z.array(ConnectorCellSchema),
});
export type InventoryItem = z.infer<typeof InventoryItemSchema>;

/** Grid placement: integer cells on the yard, rotation clockwise in quarter turns. At rot 0 an
    engine/weapon faces W; its facing side turns with `rot` (part direction rules). */
export const PlacementSchema = z.object({
  partInstanceId: z.string(),
  gx: z.number(),
  gy: z.number(),
  rot: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
});
export type Placement = z.infer<typeof PlacementSchema>;

export const ShipSheetSchema = z.object({
  pot: z.number(),
  pdf: z.number(),
  bli: z.number(),
  esc: z.number(),
  sen: z.number(),
  crg: z.number(),
  min: z.number(),
  hp: z.number(),
  mass: z.number(),
  energyCont: z.number(),
  energyCombat: z.number(),
  batCharge: z.number(),
  batOutput: z.number(),
  batInput: z.number(),
  fuelCap: z.number(),
  fuelUse: z.number(),
  structureUsed: z.number(),
  structureBudget: z.number(),
  autonomy: z.number(),
  mob: z.number(),
  condition: z.number(),
});
export type ShipSheet = z.infer<typeof ShipSheetSchema>;

export const ShipClassTypeSchema = z.enum(['HAULER', 'TRANSPORT', 'WARSHIP', 'MINER', 'MULTIROLE']);
export type ShipClassType = z.infer<typeof ShipClassTypeSchema>;

export const ShipStatusSchema = z.enum(['IN_PORT', 'ON_MISSION', 'ADRIFT']);
export type ShipStatus = z.infer<typeof ShipStatusSchema>;

export const ShipStanceSchema = z.enum(['DEFENSIVE', 'NEUTRAL', 'AGGRESSIVE']);

export const EnergyModeSchema = z.enum(['BATTERY', 'FULL', 'OVERRIDE']);
export type EnergyMode = z.infer<typeof EnergyModeSchema>;

/** The sheet's range read as routes: how many a full tank crosses. null = the ship burns no fuel. */
export const RouteCoverageSchema = z.object({ covered: z.number(), total: z.number() });
export type RouteCoverage = z.infer<typeof RouteCoverageSchema>;

export const ShipResponseSchema = z.object({
  id: z.string(),
  ownerPlayerId: z.string(),
  name: z.string(),
  fuel: z.number(),
  status: ShipStatusSchema,
  currentLocationId: z.string(),
  stance: ShipStanceSchema,
  energyMode: EnergyModeSchema,
  layout: z.array(PlacementSchema),
  sheet: ShipSheetSchema,
  shipClass: ShipClassTypeSchema,
  /** The assembly yard: exactly these cells (relative to the bridge at [0,0]) are buildable —
      the ship's own ShipFormat selection, not a fixed bound. */
  yard: z.object({ cells: z.array(z.tuple([z.number(), z.number()])) }),
  /** Installed part instance ids with no compatible connector chain back to the bridge right
      now — still counted as mass/structure/HP, not contributing anything else. */
  disconnectedPartIds: z.array(z.string()),
  /** What the ship is doing now: drives the animated ship stage. */
  activity: z.object({
    kind: z.enum(['idle', 'flying', 'scavenging', 'repairing']),
    until: IsoDate.nullable(),
    missionId: z.string().nullable(),
  }),
  routeCoverage: RouteCoverageSchema.nullable(),
});
export type ShipResponse = z.infer<typeof ShipResponseSchema>;

export const ShipFormatSchema = z.object({
  id: z.string(),
  displayName: LocalizedTextSchema,
  description: LocalizedTextSchema,
  cells: z.array(z.tuple([z.number(), z.number()])),
  minRarity: z.string(),
});
export type ShipFormat = z.infer<typeof ShipFormatSchema>;

export const ProblemSchema = z.object({ code: z.string(), message: z.string() });
export type Problem = z.infer<typeof ProblemSchema>;

export const PreviewResponseSchema = z.object({
  sheet: ShipSheetSchema,
  shipClass: ShipClassTypeSchema,
  viability: z.object({ viable: z.boolean(), problems: z.array(ProblemSchema) }),
  layout: z.array(PlacementSchema),
  omittedPartInstanceIds: z.array(z.string()),
  disconnectedPartIds: z.array(z.string()),
  routeCoverage: RouteCoverageSchema.nullable(),
});
export type PreviewResponse = z.infer<typeof PreviewResponseSchema>;

export const RescueResponseSchema = z.object({
  shipId: z.string(),
  status: z.string(),
  cost: z.number(),
  fuel: z.number(),
  credits: z.number(),
  restartParts: z.array(z.string()),
});
export type RescueResponse = z.infer<typeof RescueResponseSchema>;

// ---------------------------------------------------------------------------------------------
// World, board, missions
// ---------------------------------------------------------------------------------------------

export const MissionTypeSchema = z.enum([
  'DELIVERY',
  'TRANSPORT',
  'ESCORT',
  'MINING',
  'RESCUE',
  'TRAVEL',
  'SCAVENGE',
]);
export type MissionType = z.infer<typeof MissionTypeSchema>;

export const MissionStatusSchema = z.enum([
  'AVAILABLE',
  'HELD',
  'ACCEPTED',
  'IN_TRANSIT',
  'RESOLVING',
  'DONE',
  'FAILED',
  'EXPIRED',
]);
export type MissionStatus = z.infer<typeof MissionStatusSchema>;

export const RiskBandSchema = z.enum(['lo', 'md', 'hi']);
export type RiskBand = z.infer<typeof RiskBandSchema>;

export const WorldLocationSchema = z.object({
  id: z.string(),
  displayName: LocalizedTextSchema,
  description: LocalizedTextSchema,
  type: z.string(),
  x: z.number(),
  y: z.number(),
  zone: z.number(),
  factionId: z.string(),
  isolation: z.number(),
  services: z.record(z.string(), z.unknown()),
  risk: RiskBandSchema,
  missionCount: z.number(),
});
export type WorldLocation = z.infer<typeof WorldLocationSchema>;

export const WorldRouteSchema = z.object({
  id: z.string(),
  nodeAId: z.string(),
  nodeBId: z.string(),
  distance: z.number(),
  danger: z.number(),
  /** Server-decided hot corridor (D24) — the client holds no threshold. */
  hot: z.boolean(),
});
export type WorldRoute = z.infer<typeof WorldRouteSchema>;

export const WorldResponseSchema = z.object({
  locations: z.array(WorldLocationSchema),
  routes: z.array(WorldRouteSchema),
});
export type WorldResponse = z.infer<typeof WorldResponseSchema>;

export const EligibilityReasonSchema = z.object({ code: z.string(), message: z.string() });
export type EligibilityReason = z.infer<typeof EligibilityReasonSchema>;

export const BoardEligibilitySchema = z.object({
  eligible: z.boolean(),
  reasons: z.array(EligibilityReasonSchema),
});
export type BoardEligibility = z.infer<typeof BoardEligibilitySchema>;

/** One requirement check, always present regardless of pass/fail (round 10: "show the
    requirements for the mission, in a clear way, not only the text"). */
export const RequirementCheckSchema = z.object({
  code: z.string(),
  message: z.string(),
  met: z.boolean(),
});
export type RequirementCheck = z.infer<typeof RequirementCheckSchema>;

export const MissionInstanceDataSchema = z.object({
  id: z.string(),
  templateId: z.string(),
  type: MissionTypeSchema,
  factionId: z.string(),
  originId: z.string(),
  destinationId: z.string(),
  legs: Json,
  cargo: Json,
  reward: z.number(),
  expiresAt: IsoDate,
  status: MissionStatusSchema,
  playerId: z.string().nullable(),
  /** D43: set on a player's private start-safe mission; null for every shared offer. */
  privatePlayerId: z.string().nullable(),
  shipId: z.string().nullable(),
  acceptedAt: IsoDate.nullable(),
  arrivalAt: IsoDate.nullable(),
  deadlineAt: IsoDate.nullable(),
  seed: z.string(),
  version: z.number(),
});
export type MissionInstanceData = z.infer<typeof MissionInstanceDataSchema>;

/** GET /v1/locations/:id/missions — board rows carry the estimate and the upfront verdict. */
export const OfferInfoSchema = z.object({
  title: LocalizedTextSchema,
  description: LocalizedTextSchema,
  legCount: z.number(),
  totalDistance: z.number(),
  peakDanger: z.number(),
  peakZone: z.number(),
  /** Time and fuel for the viewer's own ship; null when they have no flyable ship. */
  estimate: z.object({ durationSeconds: z.number(), fuelNeeded: z.number() }).nullable(),
  /** Mining offers: what to dig for. */
  material: z
    .object({ name: LocalizedTextSchema, contracted: z.boolean(), quantity: z.number().nullable() })
    .nullable(),
  /** Full requirement checklist (met + unmet); empty when the viewer has no ship to check. */
  requirements: z.array(RequirementCheckSchema),
});
export type OfferInfo = z.infer<typeof OfferInfoSchema>;

export const MissionOfferSchema = MissionInstanceDataSchema.extend({
  rewardEstimate: z.number(),
  eligibility: BoardEligibilitySchema,
  info: OfferInfoSchema,
});
export type MissionOffer = z.infer<typeof MissionOfferSchema>;

export const LegWindowSchema = z.object({
  legIndex: z.number(),
  routeId: z.string(),
  from: IsoDate,
  to: IsoDate,
});
export type LegWindow = z.infer<typeof LegWindowSchema>;

/** Just enough of the template's own words to caption an active mission (title + full brief). */
export const MissionBriefSchema = z.object({
  title: LocalizedTextSchema,
  description: LocalizedTextSchema,
});
export type MissionBrief = z.infer<typeof MissionBriefSchema>;

/** GET /v1/missions/active — the raw instance plus the in-transit leg windows (empty before dispatch). */
export const ActiveMissionSchema = MissionInstanceDataSchema.extend({
  legWindows: z.array(LegWindowSchema),
  brief: MissionBriefSchema,
});
export type ActiveMission = z.infer<typeof ActiveMissionSchema>;

export const DurationClassSchema = z.enum(['fast', 'medium', 'long']);

export const DispatchResponseSchema = z.object({
  missionId: z.string(),
  arrivalAt: IsoDate,
  serverTime: IsoDate,
  durationSeconds: z.number().optional(),
  durationClass: DurationClassSchema.optional(),
});
export type DispatchResponse = z.infer<typeof DispatchResponseSchema>;

// ---------------------------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------------------------

export const ReportViewNameSchema = z.enum(['summary', 'narrative', 'log']);
export type ReportViewName = z.infer<typeof ReportViewNameSchema>;

export const ReportSegmentSchema = z.discriminatedUnion('t', [
  z.object({ t: z.literal('text'), value: z.string() }),
  z.object({
    t: z.literal('ref'),
    kind: z.enum(['part', 'loot']),
    id: z.string(),
    value: z.string(),
  }),
]);
export type ReportSegment = z.infer<typeof ReportSegmentSchema>;

export const ReportLineSchema = z.object({
  text: z.string(),
  segments: z.array(ReportSegmentSchema),
});
export type ReportLine = z.infer<typeof ReportLineSchema>;

export const MissionDamageCascadeSchema = z.object({
  shield: z.number(),
  armor: z.number(),
  hp: z.number(),
});
export type MissionDamageCascade = z.infer<typeof MissionDamageCascadeSchema>;

/** One attack inside a fight's round-by-round log (player's own perspective). */
export const MissionCombatRoundSchema = z.object({
  round: z.number(),
  attacker: z.enum(['player', 'enemy']),
  roll: z.number(),
  // Optional: reports resolved before this breakdown existed have rounds but no pdf/bonus.
  pdf: z.number().optional(),
  bonus: z.number().optional(),
  dc: z.number(),
  hit: z.boolean(),
  damage: z.number(),
  armorAbsorbed: z.number(),
  shieldAbsorbed: z.number(),
  hullDamage: z.number(),
});
export type MissionCombatRound = z.infer<typeof MissionCombatRoundSchema>;

export const NarrativeLineSchema = ReportLineSchema.extend({
  detail: z
    .object({
      cascade: MissionDamageCascadeSchema,
      rounds: z.array(MissionCombatRoundSchema).optional(),
    })
    .optional(),
});
export type NarrativeLine = z.infer<typeof NarrativeLineSchema>;

export const NarrativeChapterSchema = z.object({
  leg: z.number(),
  header: ReportLineSchema,
  lines: z.array(NarrativeLineSchema),
});
export type NarrativeChapter = z.infer<typeof NarrativeChapterSchema>;

export const ReportStatsSchema = z.object({
  credits: z.number(),
  balanceAfter: z.number().nullable(),
  legs: z.number(),
  distance: z.number(),
  fights: z.object({
    won: z.number(),
    lost: z.number(),
    escaped: z.number(),
    drawn: z.number(),
    pvp: z.number(),
  }),
  damage: z.object({ shield: z.number(), armor: z.number(), hull: z.number() }),
  /** Whether the dispatched ship had a shield at all (a DEFENSE part with ESC > 0). */
  hasShield: z.boolean(),
  /** Every part that lost condition during the run, dispatch vs final. */
  partsDamage: z.array(
    z.object({
      partId: z.string(),
      partType: z.string(),
      name: z.string(),
      before: z.number(),
      after: z.number(),
    }),
  ),
  partFailures: z.number(),
  fuelLost: z.number(),
  found: z.array(
    z.object({
      kind: z.enum(['part', 'scrap']),
      partType: z.string(),
      name: z.string(),
      condition: z.number(),
    }),
  ),
  pirates: z.object({ stolenParts: z.number(), motive: z.string().nullable() }),
  loot: z.array(z.object({ materialId: z.string(), name: z.string(), quantity: z.number() })),
});
export type ReportStats = z.infer<typeof ReportStatsSchema>;

export const ReportMissionSchema = z.object({
  type: MissionTypeSchema,
  originId: z.string(),
  destinationId: z.string(),
  reward: z.number(),
  title: LocalizedTextSchema,
});
export type ReportMission = z.infer<typeof ReportMissionSchema>;

const reportBase = {
  locale: z.string(),
  outcome: z.string(),
  stats: ReportStatsSchema,
  mission: ReportMissionSchema.optional(),
};
export const ReportResponseSchema = z.discriminatedUnion('view', [
  z.object({ ...reportBase, view: z.literal('summary'), lines: z.array(ReportLineSchema) }),
  z.object({ ...reportBase, view: z.literal('log'), lines: z.array(ReportLineSchema) }),
  z.object({
    ...reportBase,
    view: z.literal('narrative'),
    chapters: z.array(NarrativeChapterSchema),
  }),
]);
export type ReportResponse = z.infer<typeof ReportResponseSchema>;

export const ReportListItemSchema = z.object({
  missionId: z.string(),
  outcome: z.string(),
  credits: z.number(),
  legs: z.number(),
  createdAt: IsoDate,
  /** Any combat-category event in the run (win/loss/draw/escort-absorbed/escaped/PvP) — the
      mission history list's own "Combat" flag, owner request. */
  hadCombat: z.boolean(),
});
export type ReportListItem = z.infer<typeof ReportListItemSchema>;

export const ReportListResponseSchema = z.object({
  items: z.array(ReportListItemSchema),
  nextCursor: z.string().optional(),
});
export type ReportListResponse = z.infer<typeof ReportListResponseSchema>;

/** GET /v1/catalog/parts/:partType and /v1/catalog/materials/:id — what a report popup shows. */
export const CatalogDetailSchema = z.object({
  id: z.string(),
  kind: z.enum(['part', 'material']),
  displayName: LocalizedTextSchema,
  description: LocalizedTextSchema,
  /** Part class (parts) or rarity (materials). */
  category: z.string(),
  rarity: z.string(),
});
export type CatalogDetail = z.infer<typeof CatalogDetailSchema>;

// ---------------------------------------------------------------------------------------------
// Economy
// ---------------------------------------------------------------------------------------------

export const MarketListingSchema = z.object({
  listingId: z.string(),
  kind: z.enum(['catalog', 'used']),
  partType: z.string(),
  partClass: z.string(),
  displayName: LocalizedTextSchema,
  description: LocalizedTextSchema,
  rarity: z.string(),
  /** The part's stats, so a listing can be inspected before buying. */
  catalog: PartCatalogStatsSchema,
  condition: z.number(),
  price: z.number(),
  /** The part's generated connector cells — what a buyer receives; empty = no layout. */
  connectors: z.array(ConnectorCellSchema),
});
export type MarketListing = z.infer<typeof MarketListingSchema>;

/** What the port pays for one of the player's inventory parts (server-quoted). */
export const SellOfferSchema = z.object({ partInstanceId: z.string(), price: z.number() });
export type SellOffer = z.infer<typeof SellOfferSchema>;

export const MarketResponseSchema = z.object({
  locationId: z.string(),
  listings: z.array(MarketListingSchema),
  sellOffers: z.array(SellOfferSchema),
  /** Parts below this condition (%) are refused at every port: no quote is given for them. */
  sellMinCondition: z.number(),
});
export type MarketResponse = z.infer<typeof MarketResponseSchema>;

export const DiscardResponseSchema = z.object({ discarded: z.number() });
export type DiscardResponse = z.infer<typeof DiscardResponseSchema>;

export const BuyResponseSchema = z.object({
  partInstanceId: z.string(),
  partType: z.string(),
  condition: z.number(),
  price: z.number(),
  credits: z.number(),
});
export type BuyResponse = z.infer<typeof BuyResponseSchema>;

export const SellResponseSchema = z.object({
  partInstanceId: z.string(),
  price: z.number(),
  credits: z.number(),
});
export type SellResponse = z.infer<typeof SellResponseSchema>;

export const MaterialHoldingSchema = z.object({
  materialId: z.string(),
  displayName: LocalizedTextSchema,
  rarity: z.string(),
  quantity: z.number(),
  unitPrice: z.number(),
});
export type MaterialHolding = z.infer<typeof MaterialHoldingSchema>;

export const MaterialsResponseSchema = z.object({
  locationId: z.string(),
  materials: z.array(MaterialHoldingSchema),
});
export type MaterialsResponse = z.infer<typeof MaterialsResponseSchema>;

export const SellMaterialResponseSchema = z.object({
  materialId: z.string(),
  quantity: z.number(),
  price: z.number(),
  credits: z.number(),
});
export type SellMaterialResponse = z.infer<typeof SellMaterialResponseSchema>;

export const RefuelResponseSchema = z.object({
  shipId: z.string(),
  units: z.number(),
  cost: z.number(),
  fuel: z.number(),
  fuelCap: z.number(),
  credits: z.number(),
});
export type RefuelResponse = z.infer<typeof RefuelResponseSchema>;

export const RefuelQuoteResponseSchema = z.object({
  shipId: z.string(),
  units: z.number(),
  cost: z.number(),
  /** Price of one unit here; cost for n units is max(1, round(n × unitPrice)). */
  unitPrice: z.number(),
  fuel: z.number(),
  fuelCap: z.number(),
  /** Room left in the tank. */
  space: z.number(),
});
export type RefuelQuoteResponse = z.infer<typeof RefuelQuoteResponseSchema>;

export const RepairQuoteResponseSchema = z.object({
  shipId: z.string(),
  cost: z.number(),
  durationSeconds: z.number(),
  /** Each target's own price and time; `fee` is the workshop charge, so items + fee = cost. */
  items: z.array(
    z.object({ partInstanceId: z.string(), cost: z.number(), durationSeconds: z.number() }),
  ),
  fee: z.number(),
});
export type RepairQuoteResponse = z.infer<typeof RepairQuoteResponseSchema>;

export const RepairStartResponseSchema = z.object({
  repairJobId: z.string(),
  shipId: z.string(),
  cost: z.number(),
  durationSeconds: z.number(),
  completesAt: IsoDate,
  targets: z.array(
    z.object({
      partInstanceId: z.string(),
      fromCondition: z.number(),
      toCondition: z.number(),
    }),
  ),
});
export type RepairStartResponse = z.infer<typeof RepairStartResponseSchema>;

// Upgrade a part to its next rarity tier in place (round 5 backlog item 4): mechanism only, no
// curated chains decided here — eligibility is derived from the catalog's own naming convention
// (`hull` -> `hull_uncommon` -> `hull_rare` -> ...), so any tier the catalog happens to define is
// automatically upgradeable and one not yet defined simply reports ineligible.
export const PartUpgradeQuoteResponseSchema = z.object({
  partInstanceId: z.string(),
  eligible: z.boolean(),
  reason: z.enum(['MAX_TIER', 'NO_NEXT_TIER', 'NOT_FULL_CONDITION']).optional(),
  nextPartType: z.string().optional(),
  nextDisplayName: LocalizedTextSchema.optional(),
  cost: z.number().optional(),
  /** The next tier's own rarity and full catalog stats, so the client can build a virtual
      part and reuse the same before/after diff popup Market already has. */
  nextRarity: z.string().optional(),
  nextDescription: LocalizedTextSchema.optional(),
  nextCatalog: PartCatalogStatsSchema.optional(),
});
export type PartUpgradeQuoteResponse = z.infer<typeof PartUpgradeQuoteResponseSchema>;

export const PartUpgradeResponseSchema = z.object({
  partInstanceId: z.string(),
  partType: z.string(),
  displayName: LocalizedTextSchema,
  rarity: z.string(),
  condition: z.number(),
  cost: z.number(),
  credits: z.number(),
});
export type PartUpgradeResponse = z.infer<typeof PartUpgradeResponseSchema>;

export const ScavengeInfoSchema = z.object({
  locationId: z.string(),
  fieldType: z.enum(['common', 'mission', 'pirate']),
  /** Chance of each extra find beyond the guaranteed first one. */
  dropChance: z.number(),
  zone: z.number(),
  scrapPlace: z.boolean(),
  /** How long a job takes (mission time). */
  durationSeconds: z.number(),
  cooldownSeconds: z.number(),
  retryAfterSeconds: z.number(),
  attempts: z.number(),
  qualityMin: z.number(),
  qualityMax: z.number(),
});
export type ScavengeInfo = z.infer<typeof ScavengeInfoSchema>;

// ---------------------------------------------------------------------------------------------
// Travel without a quest
// ---------------------------------------------------------------------------------------------

export const TravelBlockerSchema = z.enum([
  'NO_SHIP',
  'SAME_PLACE',
  'NO_ROUTE',
  'ACTIVE_MISSION_EXISTS',
  'SHIP_NOT_IN_PORT',
  'SHIP_REPAIRING',
  'SHIP_NOT_VIABLE',
  'NOT_ENOUGH_FUEL',
]);
export type TravelBlocker = z.infer<typeof TravelBlockerSchema>;

export const TravelQuoteSchema = z.object({
  originId: z.string(),
  destinationId: z.string(),
  legs: z.array(
    z.object({
      routeId: z.string(),
      fromId: z.string(),
      toId: z.string(),
      distance: z.number(),
      danger: z.number(),
      zone: z.number(),
    }),
  ),
  totalDistance: z.number(),
  durationSeconds: z.number(),
  fuelNeeded: z.number(),
  fuelHave: z.number(),
  peakDanger: z.number(),
  blockers: z.array(TravelBlockerSchema),
  canDepart: z.boolean(),
});
export type TravelQuote = z.infer<typeof TravelQuoteSchema>;

// ---------------------------------------------------------------------------------------------
// Admin tuning
// ---------------------------------------------------------------------------------------------

export const AdminPlaceholderResponseSchema = z.object({ message: z.string() });
export type AdminPlaceholderResponse = z.infer<typeof AdminPlaceholderResponseSchema>;

export const ConfigEntryResponseSchema = z.object({
  key: z.string(),
  group: z.string(),
  type: z.string(),
  min: z.number().optional(),
  max: z.number().optional(),
  unit: z.string().optional(),
  description: LocalizedTextSchema,
  currentValue: Json,
  factoryDefault: Json,
  modified: z.boolean(),
});
export type ConfigEntryResponse = z.infer<typeof ConfigEntryResponseSchema>;

export const UpdateConfigValueRequestSchema = z.object({
  value: Json,
  expectedRevision: z.number(),
  reason: z.string(),
});
export type UpdateConfigValueRequest = z.infer<typeof UpdateConfigValueRequestSchema>;

export const ResetConfigValueRequestSchema = z.object({
  expectedRevision: z.number(),
  reason: z.string(),
});
export type ResetConfigValueRequest = z.infer<typeof ResetConfigValueRequestSchema>;

export const TuningRevisionResponseSchema = z.object({
  id: z.string(),
  actor: z.string(),
  entityType: z.string(),
  entityId: z.string(),
  before: Json,
  after: Json,
  reason: z.string(),
  at: IsoDate,
});
export type TuningRevisionResponse = z.infer<typeof TuningRevisionResponseSchema>;

export const BundleExportEntrySchema = z.object({
  key: z.string(),
  value: Json,
  factoryDefault: Json,
  type: z.string(),
});
export type BundleExportEntry = z.infer<typeof BundleExportEntrySchema>;

export const BundleExportSchema = z.object({
  version: z.number(),
  exportedAt: IsoDate,
  entries: z.array(BundleExportEntrySchema),
});
export type BundleExport = z.infer<typeof BundleExportSchema>;

export const BundleDiffSchema = z.object({ key: z.string(), before: Json, after: Json });
export type BundleDiff = z.infer<typeof BundleDiffSchema>;

export const EntityFieldTypeSchema = z.enum([
  'string',
  'integer',
  'float',
  'boolean',
  'json',
  'enum',
  'locale-map',
  'grid-cells',
  'connector-rules',
]);
export type EntityFieldType = z.infer<typeof EntityFieldTypeSchema>;

export const EntitySchemaFieldSchema = z.object({
  name: z.string(),
  type: EntityFieldTypeSchema,
  required: z.boolean(),
  enumValues: z.array(z.string()).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  description: LocalizedTextSchema.optional(),
  configKey: z.string().optional(),
});
export type EntitySchemaField = z.infer<typeof EntitySchemaFieldSchema>;

export const EntitySchemaResponseSchema = z.object({
  entity: z.string(),
  fields: z.array(EntitySchemaFieldSchema),
});
export type EntitySchemaResponse = z.infer<typeof EntitySchemaResponseSchema>;

export const CreateEntityRequestSchema = z.object({
  data: z.record(z.string(), z.unknown()),
  reason: z.string(),
});
export type CreateEntityRequest = z.infer<typeof CreateEntityRequestSchema>;

export const UpdateEntityRequestSchema = CreateEntityRequestSchema;
export type UpdateEntityRequest = z.infer<typeof UpdateEntityRequestSchema>;

export const RetireEntityRequestSchema = z.object({ reason: z.string() });
export type RetireEntityRequest = z.infer<typeof RetireEntityRequestSchema>;

export const EntityChangeResponseSchema = z.object({
  row: z.record(z.string(), z.unknown()),
  revision: TuningRevisionResponseSchema,
});
export type EntityChangeResponse = z.infer<typeof EntityChangeResponseSchema>;

// System (S11.2): active broadcast notices served to players.
export const SystemNoticeSchema = z.object({
  id: z.string(),
  message: LocalizedTextSchema,
});
export type SystemNotice = z.infer<typeof SystemNoticeSchema>;

export const SystemNoticesResponseSchema = z.object({
  items: z.array(SystemNoticeSchema),
});
export type SystemNoticesResponse = z.infer<typeof SystemNoticesResponseSchema>;

// Admin (S11): analytics, system flags/notices, player inspector and support actions. Written
// against the API responses and pinned by the API integration specs, like the player contract.
const AnalyticsWindowSchema = z.object({ from: z.string(), to: z.string() });

export const DashboardDataSchema = z.object({
  players: z.object({ new: z.number(), active: z.number() }),
  missions: z.object({
    total: z.number(),
    success: z.number(),
    partialFailure: z.number(),
    failed: z.number(),
    adrift: z.number(),
    successRate: z.number(),
  }),
  combat: z.object({
    encounters: z.number(),
    wins: z.number(),
    losses: z.number(),
    winrate: z.number(),
    baseline: z.number(),
  }),
  tiers: z.object({ tiers: z.record(z.string(), z.number()), ships: z.number() }),
});
export type DashboardData = z.infer<typeof DashboardDataSchema>;
export const DashboardResponseSchema = z.object({
  window: AnalyticsWindowSchema,
  data: DashboardDataSchema,
});

const NamedTotalSchema = z.object({ reason: z.string(), total: z.number() });
export const EconomyDataSchema = z.object({
  entering: z.number(),
  leaving: z.number(),
  net: z.number(),
  sources: z.array(NamedTotalSchema),
  sinks: z.array(NamedTotalSchema),
  adjustments: z.object({ granted: z.number(), removed: z.number() }),
});
export type EconomyData = z.infer<typeof EconomyDataSchema>;
export const EconomyResponseSchema = z.object({
  window: AnalyticsWindowSchema,
  data: EconomyDataSchema,
});

export const AdminWorldDataSchema = z.object({
  traffic: z.array(z.object({ routeId: z.string(), crossings: z.number() })),
  encounters: z.number(),
  zones: z.array(
    z.object({
      zone: z.union([z.string(), z.number()]),
      generated: z.number(),
      consumed: z.number(),
    }),
  ),
});
export type AdminWorldData = z.infer<typeof AdminWorldDataSchema>;
export const AdminWorldResponseSchema = z.object({
  window: AnalyticsWindowSchema,
  data: AdminWorldDataSchema,
});

export const SystemFlagSchema = z.object({
  key: z.string(),
  value: z.boolean(),
  updatedAt: z.string(),
  updatedBy: z.string().nullable(),
});
export type SystemFlag = z.infer<typeof SystemFlagSchema>;
export const SystemFlagListSchema = z.array(SystemFlagSchema);

export const AdminSystemNoticeSchema = z.object({
  id: z.string(),
  message: LocalizedTextSchema,
  active: z.boolean(),
  createdBy: z.string(),
  createdAt: z.string(),
  dismissedAt: z.string().nullable(),
});
export type AdminSystemNotice = z.infer<typeof AdminSystemNoticeSchema>;

export const PlayerListItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  credits: z.number(),
  factionId: z.string().nullable(),
  accountEmail: z.string(),
  accountStatus: z.string(),
});
export type PlayerListItem = z.infer<typeof PlayerListItemSchema>;
export const PlayerListResponseSchema = z.object({ items: z.array(PlayerListItemSchema) });

export const PlayerSheetSchema = z.object({
  account: z.object({
    id: z.string(),
    email: z.string(),
    role: z.string(),
    status: z.string(),
    createdAt: z.string(),
  }),
  player: z.object({
    id: z.string(),
    name: z.string(),
    credits: z.number(),
    locale: z.string(),
    factionId: z.string().nullable(),
    /** Owner debug switch: this player's jobs finish in seconds (see admin.debug_fast_ops_seconds). */
    debugFastOps: z.boolean(),
    createdAt: z.string(),
  }),
  ships: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      status: z.string(),
      stance: z.string(),
      fuel: z.number(),
      currentLocationId: z.string().nullable(),
    }),
  ),
  materials: z.array(z.object({ materialId: z.string(), quantity: z.number() })),
  activeMissions: z.array(
    z.object({
      id: z.string(),
      type: z.string(),
      status: z.string(),
      originId: z.string(),
      destinationId: z.string(),
      acceptedAt: z.string().nullable(),
    }),
  ),
});
export type PlayerSheet = z.infer<typeof PlayerSheetSchema>;

export const TimelineEventSchema = z.object({
  id: z.string(),
  at: z.string(),
  type: z.string(),
  creditsDelta: z.number().nullable(),
  payload: z.unknown(),
});
export type TimelineEvent = z.infer<typeof TimelineEventSchema>;
export const TimelinePageSchema = z.object({
  items: z.array(TimelineEventSchema),
  nextCursor: z.string().optional(),
});
export type TimelinePage = z.infer<typeof TimelinePageSchema>;

export const ReplayResponseSchema = z.object({
  missionId: z.string(),
  rulesHash: z.string(),
  stored: z.object({ outcome: z.string(), events: z.number() }),
  replay: z.object({ outcome: z.string(), creditsDelta: z.number(), events: z.array(z.unknown()) }),
  matchesStored: z.boolean(),
  report: ReportResponseSchema,
});
export type ReplayResponse = z.infer<typeof ReplayResponseSchema>;

export const SupportResultSchema = z.object({
  action: z.string(),
  target: z.string(),
  before: z.record(z.string(), z.unknown()),
  after: z.record(z.string(), z.unknown()),
});
export type SupportResult = z.infer<typeof SupportResultSchema>;
