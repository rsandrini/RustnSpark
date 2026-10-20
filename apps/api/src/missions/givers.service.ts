import { Injectable } from '@nestjs/common';
import type { MissionType } from '@prisma/client';
import type { GiverRef, LocalizedText, Mentor, MentorStep } from '@rustandspark/contract';
import { bilingual } from '../parts/parts.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { giverRefOf } from './giver-ref.js';
import { parsePools, voiced, type VoicePools, type VoiceValues } from './voice.js';

/** What a mission row needs to be voiced: the fields the words are built from. */
export interface VoicedMissionRow {
  readonly id: string;
  readonly giverId: string | null;
  readonly seed: string;
  readonly type: MissionType;
  readonly originId: string;
  readonly destinationId: string;
  readonly reward: number;
  readonly privatePlayerId?: string | null;
  readonly cargo: unknown;
}

/** A mission's giver and the words they say about it (null = the template's own text stays). */
export interface GiverVoice {
  readonly giver: GiverRef;
  readonly description: LocalizedText | null;
}

const STEPS: readonly MentorStep[] = [
  'build',
  'ports',
  'refuel',
  'mission',
  'dispatch',
  'report',
  'repair',
  'work',
];

const PRETTY_NUMBER = { en: 'en-US', 'pt-BR': 'pt-BR' } as const;

const textOf = (line: { en: string; 'pt-BR': string } | undefined): LocalizedText | null =>
  line === undefined ? null : { en: line.en, 'pt-BR': line['pt-BR'] };

@Injectable()
export class GiversService {
  constructor(private readonly prisma: PrismaService) {}

  /** The people behind a set of missions and the words they put on them. Rows with no giver are left out. */
  async voices(rows: readonly VoicedMissionRow[]): Promise<Map<string, GiverVoice>> {
    const withGiver = rows.filter((row) => row.giverId !== null);
    const result = new Map<string, GiverVoice>();
    if (withGiver.length === 0) return result;

    const [givers, places, materials] = await Promise.all([
      this.prisma.questGiver.findMany({
        where: { id: { in: [...new Set(withGiver.map((row) => row.giverId as string))] } },
      }),
      this.prisma.location.findMany({
        where: {
          id: { in: [...new Set(withGiver.flatMap((row) => [row.originId, row.destinationId]))] },
        },
        select: { id: true, displayName: true },
      }),
      this.prisma.material.findMany({ select: { id: true, displayName: true } }),
    ]);
    const giversById = new Map(givers.map((giver) => [giver.id, giver]));
    const placeName = new Map(places.map((place) => [place.id, bilingual(place.displayName)]));
    const materialName = new Map(
      materials.map((material) => [material.id, bilingual(material.displayName)]),
    );
    const poolsById = new Map<string, VoicePools>();

    for (const row of withGiver) {
      const giver = giversById.get(row.giverId as string);
      if (giver === undefined) continue;
      const ref = giverRefOf(giver);
      let pools = poolsById.get(giver.id);
      if (pools === undefined) {
        pools = parsePools(giver.lines);
        poolsById.set(giver.id, pools);
      }
      const origin = placeName.get(row.originId);
      const destination = placeName.get(row.destinationId);
      const materialId = (row.cargo as { materialId?: unknown } | null)?.materialId;
      const cargo = typeof materialId === 'string' ? materialName.get(materialId) : undefined;
      const values = {
        en: this.valuesFor('en', origin?.en, destination?.en, row.reward, cargo?.en),
        'pt-BR': this.valuesFor(
          'pt-BR',
          origin?.['pt-BR'],
          destination?.['pt-BR'],
          row.reward,
          cargo?.['pt-BR'],
        ),
      } satisfies VoiceValues;
      // A mentor's mission is the first flight, in their own words; everyone else speaks by mission type.
      const key = giver.role === 'MENTOR' ? 'first_flight' : `offer.${row.type}`;
      const line = voiced(pools, key, row.seed, values, { en: '', 'pt-BR': '' });
      result.set(row.id, {
        giver: ref,
        description: line.en === '' ? null : { en: line.en, 'pt-BR': line['pt-BR'] },
      });
    }
    return result;
  }

  /** A faction's mentor with every line the checklist uses; null when the faction has none. */
  async mentorOf(factionId: string): Promise<Mentor | null> {
    const row = await this.prisma.questGiver.findFirst({
      where: { factionId, role: 'MENTOR', active: true },
    });
    if (row === null) return null;
    const pools = parsePools(row.lines);
    const first = (key: string): LocalizedText | null => textOf(pools[key]?.[0]);
    const steps = {} as Mentor['steps'];
    for (const step of STEPS) {
      steps[step] = { nudge: first(`tutorial.${step}`), done: first(`tutorial.${step}.done`) };
    }
    return {
      giver: giverRefOf(row),
      welcome: first('tutorial.welcome'),
      finished: first('tutorial.finished'),
      steps,
      firstFailure: first('tutorial.first_failure'),
      lowFuel: first('tutorial.low_fuel'),
    };
  }

  private valuesFor(
    language: 'en' | 'pt-BR',
    origin: string | undefined,
    destination: string | undefined,
    reward: number,
    cargo: string | undefined,
  ): Record<string, string> {
    const values: Record<string, string> = {
      reward: reward.toLocaleString(PRETTY_NUMBER[language]),
    };
    if (origin !== undefined) values.origin = origin;
    if (destination !== undefined) values.destination = destination;
    if (cargo !== undefined) values.cargo = cargo;
    return values;
  }
}
