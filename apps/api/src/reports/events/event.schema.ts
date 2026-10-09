/**
 * Closed zod schemas for stored mission events (plan S9.1).
 *
 * The union is discriminated on `type` and covers exactly the frozen
 * `MISSION_EVENT_TYPES` (D36: no renames — renaming would orphan stored
 * logs). Two shapes, selected by `MissionLog.schemaVersion`:
 *
 * - **v1** — the pre-S9.0 shape: six core keys only, numbers accepted as
 *   any double (old rows predate integer normalization, so their magnitudes
 *   can carry decimals). Unknown keys are stripped on read.
 * - **v2** — integer-clean, strict: combat events require the layer
 *   `cascade`, the six part-failure types require `consequence` (`tank`
 *   also `fuelLost`), and any unexpected key fails the parse. This is the
 *   shape written by `resolve.service` on every new log.
 *
 * `parseMissionLogEvents` is the single entry point for read and write; a
 * schemaVersion outside 1|2 throws `UnsupportedMissionLogSchemaError`
 * (fails loudly — an unknown future/legacy log must never render guessed).
 */
import { z } from 'zod';
import type { FailureConsequence } from '../../resolution/wear/failure.resolver.js';
import type { MissionEvent, MissionEventCategory, MissionEventType } from './event.types.js';
import { MISSION_LOG_READABLE_SCHEMA_VERSIONS } from './event.types.js';

/** Every `FailureConsequence`, checked against the canonical type at compile time. */
const FAILURE_CONSEQUENCE_VALUES = [
  'leg_aborted_mission_failed',
  'shield_offline_for_leg',
  'fuel_leak',
  'next_hit_bypasses_shield',
  'weapon_skips_half_attacks',
  'guaranteed_ambush',
  'engine_overheat',
] as const satisfies readonly FailureConsequence[];

/** Part-failure event types (the six choke categories). */
const PART_FAILURE_TYPES = [
  'motor',
  'engine_push',
  'battery',
  'tank',
  'shield',
  'weapon',
  'sensor',
] as const;

/** Combat events carry the GDD §15 layer split from S9.0 on. */
const CASCADE_TYPES = ['combat_win', 'combat_loss', 'combat_draw', 'escort_absorbed'] as const;

/** The category every event type is emitted under — checked against the
 *  `MissionEventCategory` union at compile time and against every emitter
 *  by the coverage test. */
const CATEGORY_OF = {
  leg_travel: 'transit',
  fuel_exhausted: 'transit',
  combat_win: 'combat',
  combat_loss: 'combat',
  combat_draw: 'combat',
  escaped: 'combat',
  escort_absorbed: 'combat',
  escort_client_destroyed: 'failure',
  mission_wear: 'environment',
  mission_payout: 'payment',
  pirate_demand: 'failure',
  scavenge_find: 'loot',
  race_result: 'transit',
  pvp_encounter: 'combat',
  mining: 'loot',
  mining_paid: 'payment',
  mining_partial_failure: 'payment',
  motor: 'failure',
  engine_push: 'failure',
  engine_tuning: 'transit',
  battery: 'failure',
  tank: 'failure',
  shield: 'failure',
  weapon: 'failure',
  sensor: 'failure',
} as const satisfies Record<MissionEventType, MissionEventCategory>;

export class UnsupportedMissionLogSchemaError extends Error {
  readonly schemaVersion: number;

  constructor(schemaVersion: number) {
    super(
      `MissionLog schemaVersion ${schemaVersion} is not readable ` +
        `(supported: ${MISSION_LOG_READABLE_SCHEMA_VERSIONS.join(', ')})`,
    );
    this.name = 'UnsupportedMissionLogSchemaError';
    this.schemaVersion = schemaVersion;
  }
}

type SchemaVersion = 1 | 2;

function numberFor(version: SchemaVersion): z.ZodType<number> {
  // v2 writes are integer-normalized (missionEvent), so reads can demand it;
  // v1 rows were written before that guarantee and stay lenient.
  return version === 2 ? z.number().int() : z.number();
}

function eventMembers(
  version: SchemaVersion,
): [z.core.$ZodTypeDiscriminable, ...z.core.$ZodTypeDiscriminable[]] {
  const num = numberFor(version);
  const strict = version === 2;
  const object = strict ? z.strictObject : z.object;

  const actors = object({
    playerShipId: z.string().min(1),
    clientShipId: z.string().min(1).optional(),
    enemy: z.literal('pirate').optional(),
    opponentShipId: z.string().min(1).optional(),
  });
  const effects = object({
    hp: num,
    condByPart: z.record(z.string(), num),
    credits: num,
    loot: z.array(
      object({
        materialId: z.string().min(1),
        quantity: num,
      }),
    ),
  });

  const members = (Object.keys(CATEGORY_OF) as MissionEventType[]).map(
    (type): z.core.$ZodTypeDiscriminable => {
      // S9.0 enrichment (D36) exists only from schemaVersion 2 on; v1 rows are
      // the six core keys, anything else is stripped on read.
      const extras: Record<string, z.ZodType> = {};
      if (version === 2) {
        if ((CASCADE_TYPES as readonly string[]).includes(type)) {
          extras['cascade'] = object({
            shield: num,
            armor: num,
            hp: num,
          });
          // Optional even on v2 (unlike cascade): rows written before this field existed have
          // no rounds at all, and must keep reading back fine (D36 — only ADD optional fields).
          extras['rounds'] = z
            .array(
              object({
                round: num,
                attacker: z.enum(['player', 'enemy']),
                roll: num,
                // Optional even within a `rounds` row (not just the array itself): rows written
                // before this breakdown existed have rounds but no pdf/bonus, and must keep
                // reading back fine (D36 — only ADD optional fields).
                pdf: num.optional(),
                bonus: num.optional(),
                dc: num,
                hit: z.boolean(),
                damage: num,
                armorAbsorbed: num,
                armorReduced: num.optional(),
                shieldAbsorbed: num,
                hullDamage: num,
                shieldAfter: num.optional(),
                armorAfter: num.optional(),
              }),
            )
            .optional();
        }
        if (type === 'scavenge_find') {
          extras['found'] = object({
            kind: z.enum(['part', 'scrap']),
            partType: z.string().min(1),
            condition: num,
          });
        }
        if (type === 'mission_wear') {
          // The journey's own damage, split by the layer that took it (layered model only).
          extras['cascade'] = object({ shield: num, armor: num, hp: num }).optional();
        }
        if (type === 'race_result') {
          extras['race'] = object({
            place: num,
            timeScale: z.number(),
            standings: z.array(
              object({
                name: z.string(),
                // a speed has two decimals, so this is the one non-integer number a v2 event stores
                mobility: z.number(),
                seconds: num,
                you: z.boolean(),
                trouble: z.enum(['mishap', 'overheat']).optional(),
              }),
            ),
          });
        }
        if (type === 'engine_tuning') {
          extras['tuning'] = object({
            group: z.enum(['chem', 'ion']),
            levelPct: num,
            chancePct: num,
            outcome: z.enum(['held', 'failed', 'eased']),
            wear: num.optional(),
            batteries: z.boolean().optional(),
          });
        }
        if (type === 'pirate_demand') {
          extras['motive'] = z.enum(['cargo', 'parts', 'territory']);
          extras['stolen'] = z.array(z.string().min(1));
        }
        if ((PART_FAILURE_TYPES as readonly string[]).includes(type)) {
          extras['consequence'] = z.enum(FAILURE_CONSEQUENCE_VALUES);
          if (type === 'tank') {
            extras['fuelLost'] = num;
          }
        }
      }
      return object({
        leg: num,
        category: z.literal(CATEGORY_OF[type]),
        type: z.literal(type),
        actors,
        effects,
        magnitude: num,
        ...extras,
      });
    },
  );
  return members as [z.core.$ZodTypeDiscriminable, ...z.core.$ZodTypeDiscriminable[]];
}

const EVENT_ARRAY = {
  1: z.array(z.discriminatedUnion('type', eventMembers(1))),
  2: z.array(z.discriminatedUnion('type', eventMembers(2))),
} as const;

/**
 * A validated event is exactly the emitter's canonical `MissionEvent`: the
 * union checks the runtime shape (version-selected strictness, integer
 * numerics, pinned categories) while the hand-written interface stays the
 * source of truth for callers. The member list is built dynamically, so zod's
 * inference through it is loose — the assertion below names the real type
 * after validation, it does not skip it.
 */
export type ParsedMissionEvent = MissionEvent;

/**
 * Validates one stored/written event array against the schema its
 * `MissionLog.schemaVersion` selects. Read: from `MissionLog.legs`.
 * Write: `resolve.service` before `missionLog.create`.
 */
export function parseMissionLogEvents(schemaVersion: number, raw: unknown): ParsedMissionEvent[] {
  if (schemaVersion === 1) return EVENT_ARRAY[1].parse(raw) as ParsedMissionEvent[];
  if (schemaVersion === 2) return EVENT_ARRAY[2].parse(raw) as ParsedMissionEvent[];
  throw new UnsupportedMissionLogSchemaError(schemaVersion);
}

/** The union member schemas, exposed for coverage/shape tests. */
export const missionEventSchema = {
  1: EVENT_ARRAY[1].element,
  2: EVENT_ARRAY[2].element,
} as const;
