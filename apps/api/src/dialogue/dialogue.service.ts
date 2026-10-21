import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import type { QuestGiver } from '@prisma/client';
import { RefuelService } from '../economy/refuel.service.js';
import { giverRefOf } from '../missions/giver-ref.js';
import type { GiverRef } from '../missions/giver-types.js';
import { bilingual } from '../parts/parts.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { parseScenes, type Localized, type NodeData, type SceneData } from './scenes.js';
import { dueScene, type DialogueFacts, type SceneProgress } from './triggers.js';

/** A ship counts as built once this many parts are laid out on its grid (the starter kit is seven). */
const BUILT_PARTS = 4;
/** The pilot's own jobs are not "missions finished" for the mentor. */
const OWN_JOB_TYPES = ['SCAVENGE', 'TRAVEL'] as const;

export interface DialogueScene {
  readonly id: string;
  readonly title: Localized;
  readonly giver: GiverRef;
  readonly start: string;
  readonly nodes: readonly NodeData[];
}

export interface DialogueState {
  readonly enabled: boolean;
  readonly scene: DialogueScene | null;
  readonly replayable: readonly { id: string; title: Localized }[];
}

@Injectable()
export class DialogueService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly refuel: RefuelService,
  ) {}

  async getState(playerId: string): Promise<DialogueState> {
    const player = await this.prisma.player.findUniqueOrThrow({
      where: { id: playerId },
      select: { factionId: true, dialogueEnabled: true },
    });
    const mentor = await this.mentorOf(player.factionId);
    if (mentor === null) return { enabled: player.dialogueEnabled, scene: null, replayable: [] };

    const scenes = parseScenes(mentor.scenes);
    const progress = await this.progressOf(playerId);
    const replayable = scenes
      .filter((scene) => {
        const status = progress.find((entry) => entry.sceneId === scene.id)?.status;
        return status === 'DONE' || status === 'SKIPPED';
      })
      .map((scene) => ({ id: scene.id, title: bilingual(scene.title) }));
    if (!player.dialogueEnabled) return { enabled: false, scene: null, replayable };

    const due = dueScene(scenes, progress, await this.factsOf(playerId, player.factionId));
    if (due === undefined) return { enabled: true, scene: null, replayable };
    return {
      enabled: true,
      replayable,
      scene: {
        id: due.scene.id,
        title: bilingual(due.scene.title),
        giver: giverRefOf(mentor),
        start: due.resumeAt ?? due.scene.start,
        nodes: due.scene.nodes,
      },
    };
  }

  /** `advance` remembers the node reached; `skip` and `done` close the scene. Repeating a call changes nothing. */
  async record(
    playerId: string,
    sceneId: string,
    event: 'advance' | 'skip' | 'done',
    nodeId?: string,
  ): Promise<void> {
    const scene = await this.sceneOf(playerId, sceneId);
    if (nodeId !== undefined && !scene.nodes.some((node) => node.id === nodeId)) {
      throw new NotFoundException('node not found in this scene');
    }
    const status = event === 'advance' ? 'OPEN' : event === 'skip' ? 'SKIPPED' : 'DONE';
    await this.prisma.playerDialogue.upsert({
      where: { playerId_sceneId: { playerId, sceneId } },
      create: { playerId, sceneId, status, nodeId: nodeId ?? null },
      update: { status, ...(nodeId === undefined ? {} : { nodeId }) },
    });
  }

  /** Makes a scene the pilot has been through due again at once, from its start. */
  async replay(playerId: string, sceneId: string): Promise<void> {
    await this.sceneOf(playerId, sceneId);
    const row = await this.prisma.playerDialogue.findUnique({
      where: { playerId_sceneId: { playerId, sceneId } },
    });
    if (row === null) throw new ConflictException({ error: 'SCENE_NOT_SEEN' });
    await this.prisma.playerDialogue.update({
      where: { playerId_sceneId: { playerId, sceneId } },
      data: { status: 'REPLAY', nodeId: null },
    });
  }

  async setEnabled(playerId: string, enabled: boolean): Promise<void> {
    await this.prisma.player.update({
      where: { id: playerId },
      data: { dialogueEnabled: enabled },
    });
  }

  private async mentorOf(factionId: string | null): Promise<QuestGiver | null> {
    if (factionId === null) return null;
    return this.prisma.questGiver.findFirst({
      where: { factionId, role: 'MENTOR', active: true },
    });
  }

  private async sceneOf(playerId: string, sceneId: string): Promise<SceneData> {
    const player = await this.prisma.player.findUniqueOrThrow({
      where: { id: playerId },
      select: { factionId: true },
    });
    const mentor = await this.mentorOf(player.factionId);
    const scene = parseScenes(mentor?.scenes).find((entry) => entry.id === sceneId);
    if (scene === undefined) throw new NotFoundException('scene not found');
    return scene;
  }

  private async progressOf(playerId: string): Promise<SceneProgress[]> {
    const rows = await this.prisma.playerDialogue.findMany({ where: { playerId } });
    return rows.map((row) => ({ sceneId: row.sceneId, status: row.status, nodeId: row.nodeId }));
  }

  private async factsOf(playerId: string, factionId: string | null): Promise<DialogueFacts> {
    const [ship, completed, failed] = await Promise.all([
      this.prisma.ship.findFirst({
        where: { ownerPlayerId: playerId },
        orderBy: { id: 'asc' },
        select: { id: true, fuel: true, layout: true },
      }),
      this.prisma.missionInstance.count({
        where: {
          playerId,
          status: { in: ['DONE', 'FAILED'] },
          type: { notIn: [...OWN_JOB_TYPES] },
        },
      }),
      this.prisma.missionInstance.count({
        where: { playerId, status: 'FAILED', type: { notIn: [...OWN_JOB_TYPES] } },
      }),
    ]);
    const built = ship !== null && Array.isArray(ship.layout) && ship.layout.length >= BUILT_PARTS;
    let tankFraction: number | null = null;
    if (ship !== null && built) {
      const { fuelCap } = await this.refuel.tankOf(playerId, ship.id);
      tankFraction = fuelCap > 0 ? ship.fuel / fuelCap : null;
    }
    return { onboarded: factionId !== null, shipBuilt: built, completed, failed, tankFraction };
  }
}
