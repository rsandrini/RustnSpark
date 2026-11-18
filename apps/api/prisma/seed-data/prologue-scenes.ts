import type { PrismaClient } from '@prisma/client';
import type { SceneData } from '../../src/dialogue/scenes.js';
import { PROLOGUE_SCENES_DATA } from './prologue-scenes.data.js';

/**
 * Default dialogue scenes for the new-pilot opening (the words themselves are in `prologue-scenes.data.ts`).
 */

export const PROLOGUE_SCENES: Readonly<Record<string, readonly SceneData[]>> = PROLOGUE_SCENES_DATA;

/** Every step that must have at least one scene, checked by the seed coverage test. */
export const PROLOGUE_STEPS = [
  'gift',
  'fit-engine',
  'race-board',
  'race',
  'race-report',
  'stop-port',
  'choose-job',
  'buy-module',
  'fit-module',
  'dispatch-job',
  'job-report',
  'repair',
  'upgrade',
  'stop-two',
  'final-run',
  'loss',
  'rescue',
  'later',
] as const;

/**
 * Gives each prologue guide their default scenes while the column is still empty. Admin owns the
 * rows once seeded; this only sets the starting content.
 */
export function defaultScenesFor(giverId: string): readonly SceneData[] | undefined {
  return PROLOGUE_SCENES[giverId];
}

/**
 * Seeds the default prologue scenes into the free faction mentors. A guide that already has scenes
 * is left exactly as it is.
 */
export async function seedPrologueScenes(prisma: PrismaClient): Promise<void> {
  for (const [giverId, scenes] of Object.entries(PROLOGUE_SCENES)) {
    await prisma.$executeRaw`
      UPDATE "QuestGiver" SET "scenes" = ${JSON.stringify(scenes)}::jsonb
      WHERE "id" = ${giverId} AND "scenes" = '[]'::jsonb
    `;
  }
}
