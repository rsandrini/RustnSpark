/**
 * Report-facing mission-event surface (plan S9.1).
 *
 * The canonical type union lives with the emitter
 * (`resolution/events/mission-event.ts`) so `missionEvent()` is compiler-
 * closed over it; this module re-exports it plus the MissionLog schema
 * versions the API knows how to read. D36: version 2 is the enriched shape
 * (cascade / consequence / fuelLost); version 1 rows stay readable forever.
 */

export {
  MISSION_EVENT_TYPES,
  type MissionEventType,
  type MissionEvent,
  type MissionEventCategory,
  type MissionDamageCascade,
  type MissionActors,
  type MissionLoot,
} from '../../resolution/events/mission-event.js';

/** Schema version every new MissionLog row is written with (S9.0 / D36). */
export const MISSION_LOG_SCHEMA_VERSION = 2;

/** Versions the read path accepts; anything else fails loudly (S9.1). */
export const MISSION_LOG_READABLE_SCHEMA_VERSIONS = [1, 2] as const;
