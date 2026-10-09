import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { fuelUnits } from '../economy/fuel-cost.calculator.js';
import { GameConfigService } from '../config/game-config.service.js';
import type { ConnectorLayout } from '../parts/connectors.js';
import type { Placement } from '../parts/part.types.js';
import { PartsService, pickCatalogStats } from '../parts/parts.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  applyEngineLevels,
  clampLevels,
  cleanRunChance,
  engineGroupOf,
  type EngineGroup,
  type EngineLevels,
} from '../resolution/engine/engine.js';
import { allocatePower, powerPartOf } from '../resolution/power/power.js';
import { applyConnectivity } from '../ships/connectivity.js';
import { connectedPartIds } from '../ships/geometry.js';
import { flightShip } from '../ships/penalties.js';
import { deriveSheet, rawMobility } from '../ships/sheet.deriver.js';
import { parseDispatchLegs } from './dispatch.service.js';
import { missionDuration } from './duration.calculator.js';
import { ACTIVE_STATUSES } from './missions.service.js';

export interface EngineTrip {
  readonly missionId: string;
  readonly legCount: number;
  readonly durationSeconds: number;
  readonly fuelNeeded: number;
  readonly fuelHave: number;
  readonly fuelCap: number;
  /** The trip's fuel fits in what the ship carries now. */
  readonly fits: boolean;
}

export interface EnginePreview {
  /** The levels this preview is for (kept inside the admin's ranges). */
  readonly levels: EngineLevels;
  readonly ranges: { readonly chem: [number, number]; readonly ion: [number, number] };
  /** Which engine groups the ship has (a slider for a group it lacks does nothing). */
  readonly groups: readonly EngineGroup[];
  /** Speed (mobility, unrounded) and fuel burn per distance at these levels. */
  readonly mobility: number;
  readonly fuelUse: number;
  /** Cruising power at these levels: generated, drawn and what is spare. */
  readonly power: { readonly supply: number; readonly demand: number; readonly spare: number };
  /** Chance no engine fails on the whole run (1 when nothing is pushed). */
  readonly cleanChance: number;
  /** The same figures at level 1, to show what the tuning changes. */
  readonly baseline: { readonly mobility: number; readonly fuelUse: number };
  /** For a given mission: the trip at these levels (and at level 1). */
  readonly trip?: EngineTrip & { readonly baseline: { durationSeconds: number; fuelNeeded: number } };
}

/**
 * What the engine tuning does to a ship, before it is saved or flown: speed, fuel, power, the
 * chance of a clean run and, for a mission, its time and fuel. Same maths the dispatch uses.
 */
@Injectable()
export class EnginePreviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: GameConfigService,
    private readonly parts: PartsService,
  ) {}

  async preview(
    shipId: string,
    playerId: string,
    request: { chem?: number; ion?: number; missionId?: string },
  ): Promise<EnginePreview> {
    const { rules } = this.config.snapshot();
    const ship = await this.prisma.ship.findFirst({ where: { id: shipId, ownerPlayerId: playerId } });
    if (!ship) throw new NotFoundException('ship not found');

    const rows = await this.parts.findPlayerParts(playerId);
    const installedRows = rows.filter(
      (part) => part.location === 'INSTALLED' && part.shipId === ship.id,
    );
    const installed = installedRows.map((part) => ({
      instance: part,
      catalog: pickCatalogStats(part.partCatalog),
    }));
    const catalogForConnectivity = new Map(installed.map((p) => [p.instance.id, p.catalog]));
    const connectorsByInstance = new Map(
      installedRows.map((row) => [row.id, row.connectors as ConnectorLayout | null]),
    );
    const placements = (ship.layout as unknown as Placement[]) ?? [];
    const connectedIds = connectedPartIds(placements, catalogForConnectivity, connectorsByInstance);
    const connected = applyConnectivity(installed, connectedIds);
    const flight = flightShip(connected, placements, catalogForConnectivity, connectorsByInstance, rules);

    const levels = clampLevels(
      { chem: request.chem ?? ship.chemLevel, ion: request.ion ?? ship.ionLevel },
      rules,
    );
    const tunedParts = applyEngineLevels(flight.parts, levels, rules);
    const tunedSheet = deriveSheet(tunedParts, rules);
    const baseSheet = flight.sheet;

    const powerState = allocatePower(
      tunedParts.map((part) => powerPartOf(part.instance.id, part.catalog, rules.power.idle_demand)),
      'cruise',
      rules,
    );
    const engineParts = tunedParts
      .map((part) => ({
        engineGroup: engineGroupOf(part.catalog) ?? undefined,
        condition: part.instance.condition,
      }))
      .filter((part) => part.engineGroup !== undefined);
    const groups = [...new Set(engineParts.map((part) => part.engineGroup!))];

    let trip: EnginePreview['trip'];
    if (request.missionId !== undefined) {
      const mission = await this.prisma.missionInstance.findFirst({
        where: { id: request.missionId, playerId, status: { in: [...ACTIVE_STATUSES] } },
      });
      if (!mission) throw new NotFoundException('mission not found');
      if (mission.type === 'SCAVENGE') throw new ConflictException({ error: 'NOT_A_FLIGHT' });
      const legs = parseDispatchLegs(mission.legs);
      const tripOf = (sheet: ReturnType<typeof deriveSheet>) => ({
        durationSeconds: missionDuration({
          totalDistance: legs.reduce((sum, leg) => sum + leg.distance, 0),
          mobility: sheet.mob,
          durationK: rules.missions.duration_k,
          timeScale: rules.missions.time_scale,
          classCutoffs: rules.missions.duration_class_cutoffs,
        }).durationSeconds,
        fuelNeeded: legs.reduce(
          (sum, leg) =>
            sum +
            fuelUnits({
              fuelUse: sheet.fuelUse,
              distance: leg.distance,
              envFuelMult: leg.env.fuelMult,
            }),
          0,
        ),
      });
      const tuned = tripOf(tunedSheet);
      trip = {
        missionId: mission.id,
        legCount: legs.length,
        ...tuned,
        fuelHave: ship.fuel,
        fuelCap: tunedSheet.fuelCap,
        fits: tuned.fuelNeeded <= ship.fuel,
        baseline: tripOf(baseSheet),
      };
    }

    return {
      levels,
      ranges: {
        chem: [rules.engine.chem_level_min, rules.engine.chem_level_max],
        ion: [rules.engine.ion_level_min, rules.engine.ion_level_max],
      },
      groups,
      mobility: rawMobility(tunedSheet.pot, tunedSheet.mass, rules),
      fuelUse: tunedSheet.fuelUse,
      power: {
        supply: powerState.supply,
        demand: powerState.demand,
        spare: powerState.supply - powerState.demand,
      },
      cleanChance: cleanRunChance(engineParts, levels, trip?.legCount ?? 1, rules),
      baseline: {
        mobility: rawMobility(baseSheet.pot, baseSheet.mass, rules),
        fuelUse: baseSheet.fuelUse,
      },
      ...(trip !== undefined ? { trip } : {}),
    };
  }
}
