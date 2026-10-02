import { Injectable } from '@nestjs/common';
import type { Prisma, TuningRevision } from '@prisma/client';
import { Inject } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../../common/redis/redis.module.js';
import { GameConfigService } from '../../config/game-config.service.js';
import { GameConfigRepository } from '../../config/game-config.repository.js';
import { GameConfigValidationError } from '../../config/game-config.types.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { buildEntityValidator, getEntitySchema, type EntitySchema } from './entity-schemas.js';

const ENTITY_CHANGE_CHANNEL = 'entity:changed';

interface PrismaDelegate {
  findMany: (args?: unknown) => Promise<unknown[]>;
  findUnique: (args?: unknown) => Promise<unknown>;
  create: (args?: unknown) => Promise<unknown>;
  update: (args?: unknown) => Promise<unknown>;
  delete?: (args?: unknown) => Promise<unknown>;
}

const ENTITY_MODEL_DELEGATE: Record<string, string> = {
  parts: 'partCatalog',
  materials: 'material',
  factions: 'faction',
  locations: 'location',
  routes: 'route',
  environments: 'environment',
  'mission-templates': 'missionTemplate',
  'drop-tables': 'dropTable',
  'ship-formats': 'shipFormat',
};

const ID_FIELD: Record<string, string> = {
  parts: 'partType',
};

function getIdField(entity: string): string {
  return ID_FIELD[entity] ?? 'id';
}

function getEntityId(entity: string, row: Record<string, unknown>): string {
  const idField = getIdField(entity);
  return String(row[idField]);
}

function rowToJson(row: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(row)) as Record<string, unknown>;
}

function buildZodIssues(error: unknown): Array<{ key: string; message: string; value?: unknown }> {
  if (typeof error === 'object' && error !== null && 'issues' in error) {
    return (error as { issues: Array<{ path: (string | number)[]; message: string }> }).issues.map(
      (issue) => ({
        key: issue.path.join('.'),
        message: issue.message,
      }),
    );
  }
  return [{ key: 'unknown', message: 'Validation failed' }];
}

type PrismaClientLike = PrismaService | Prisma.TransactionClient;

function getDelegate(client: PrismaClientLike, entity: string): PrismaDelegate {
  const name = ENTITY_MODEL_DELEGATE[entity];
  if (!name) {
    throw new GameConfigValidationError(`Unknown entity: ${entity}`, [
      { key: entity, message: 'Unknown entity' },
    ]);
  }
  const delegate = (client as unknown as Record<string, unknown>)[name] as
    PrismaDelegate | undefined;
  if (!delegate) {
    throw new GameConfigValidationError(`Prisma delegate not found: ${name}`, [
      { key: entity, message: 'Prisma delegate not found' },
    ]);
  }
  return delegate;
}

@Injectable()
export class EntityTuningService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gameConfigService: GameConfigService,
    private readonly gameConfigRepository: GameConfigRepository,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  getSchema(entity: string): Record<string, unknown> {
    const schema = this.resolveSchema(entity);
    return {
      entity: schema.entity,
      fields: schema.fields.map((field) => ({
        name: field.name,
        type: field.type,
        required: field.required,
        enumValues: field.enumValues,
        min: field.min,
        max: field.max,
        description: field.description,
        configKey: field.configKey,
      })),
    };
  }

  private getDelegate(entity: string): PrismaDelegate {
    return getDelegate(this.prisma, entity);
  }

  async list(entity: string): Promise<Record<string, unknown>[]> {
    const schema = this.resolveSchema(entity);
    const delegate = this.getDelegate(entity);
    const rows = (await delegate.findMany()) as unknown as Array<Record<string, unknown>>;
    return rows.map((row) => this.serializeRow(row, schema));
  }

  async getById(entity: string, id: string): Promise<Record<string, unknown> | null> {
    const schema = this.resolveSchema(entity);
    const delegate = this.getDelegate(entity);
    const idField = getIdField(entity);
    const row = (await delegate.findUnique({
      where: { [idField]: id },
    })) as Record<string, unknown> | null;
    return row ? this.serializeRow(row, schema) : null;
  }

  async create(
    entity: string,
    data: Record<string, unknown>,
    actor: string,
    reason: string,
  ): Promise<{ row: Record<string, unknown>; revision: TuningRevision }> {
    const schema = this.resolveSchema(entity);
    const validated = this.validateData(schema, data, 'create');
    await this.validateEntityRules(entity, validated, 'create');

    const result = await this.prisma.$transaction(async (tx) => {
      const row = (await getDelegate(tx, entity).create({
        data: validated,
      })) as Record<string, unknown>;
      const revision = await this.createRevision(
        actor,
        entity,
        getEntityId(entity, row),
        null,
        rowToJson(row),
        reason,
        tx,
      );
      return { row, revision };
    });

    await this.publishChange(entity);
    return { row: this.serializeRow(result.row, schema), revision: result.revision };
  }

  async update(
    entity: string,
    id: string,
    data: Record<string, unknown>,
    actor: string,
    reason: string,
  ): Promise<{ row: Record<string, unknown>; revision: TuningRevision }> {
    const schema = this.resolveSchema(entity);
    const validated = this.validateData(schema, data, 'update');
    const idField = getIdField(entity);
    if (validated[idField] !== undefined && validated[idField] !== id) {
      throw new GameConfigValidationError('Editing the row id is not allowed', [
        { key: idField, message: 'Editing the row id is not allowed' },
      ]);
    }
    if (validated.active === false) {
      // Setting `active` directly is a retirement and must obey the same guards as DELETE.
      this.assertCanRetire(entity, id);
    }
    await this.validateEntityRules(entity, validated, 'update', id);

    const result = await this.prisma.$transaction(async (tx) => {
      const before = (await getDelegate(tx, entity).findUnique({
        where: { [idField]: id },
      })) as Record<string, unknown> | null;
      if (!before) {
        throw new GameConfigValidationError(`${entity} not found: ${id}`, [
          { key: id, message: 'Not found' },
        ]);
      }
      const row = (await getDelegate(tx, entity).update({
        where: { [idField]: id },
        data: validated,
      })) as Record<string, unknown>;
      const revision = await this.createRevision(
        actor,
        entity,
        getEntityId(entity, row),
        rowToJson(before),
        rowToJson(row),
        reason,
        tx,
      );
      return { row, revision };
    });

    await this.publishChange(entity);
    return { row: this.serializeRow(result.row, schema), revision: result.revision };
  }

  async retire(
    entity: string,
    id: string,
    actor: string,
    reason: string,
  ): Promise<{ row: Record<string, unknown>; revision: TuningRevision }> {
    if (!['parts', 'materials', 'mission-templates', 'routes'].includes(entity)) {
      throw new GameConfigValidationError(`Entity ${entity} does not support retirement`, [
        { key: entity, message: 'Retirement not supported for this entity' },
      ]);
    }

    const schema = this.resolveSchema(entity);
    const idField = getIdField(entity);

    this.assertCanRetire(entity, id);

    const result = await this.prisma.$transaction(async (tx) => {
      const txDelegate = getDelegate(tx, entity);
      const before = (await txDelegate.findUnique({
        where: { [idField]: id },
      })) as Record<string, unknown> | null;
      if (!before) {
        throw new GameConfigValidationError(`${entity} not found: ${id}`, [
          { key: id, message: 'Not found' },
        ]);
      }

      let row: Record<string, unknown>;
      if (entity === 'routes') {
        await this.assertRouteDeletionSafe(id);
        await txDelegate.delete?.({ where: { [idField]: id } });
        row = { ...before, active: false };
      } else {
        row = (await txDelegate.update({
          where: { [idField]: id },
          data: { active: false },
        })) as Record<string, unknown>;
      }

      const revision = await this.createRevision(
        actor,
        entity,
        getEntityId(entity, row),
        rowToJson(before),
        rowToJson(row),
        reason,
        tx,
      );
      return { row, revision };
    });

    await this.publishChange(entity);
    return { row: this.serializeRow(result.row, schema), revision: result.revision };
  }

  async revertRevision(id: bigint, actor: string, reason: string): Promise<TuningRevision> {
    const revision = await this.gameConfigRepository.findRevisionById(id);
    if (!revision) {
      throw new GameConfigValidationError(`Revision not found: ${id.toString()}`, [
        { key: String(id), message: 'Revision not found' },
      ]);
    }
    if (revision.before === null || revision.before === undefined) {
      throw new GameConfigValidationError(
        `Cannot revert revision ${id.toString()}: no before state`,
        [{ key: revision.entityId, message: 'No before state' }],
      );
    }

    if (revision.entityType === 'GameConfig') {
      return this.gameConfigService.setValue(revision.entityId, revision.before, actor, reason);
    }

    const entity = revision.entityType;
    const schema = this.resolveSchema(entity);
    const idField = getIdField(entity);
    const rowId = String(getEntityId(entity, revision.before as Record<string, unknown>));
    // Restoring an old state goes through the same validation as a fresh write: a revision can
    // predate rules (e.g. a symmetric faction matrix) that the restored row would now violate.
    const restored = this.serializeRow(revision.before as Record<string, unknown>, schema);
    // Nullable columns come back as null, which the create validator (optional, not nullable)
    // rejects; validate without them but write the row back exactly as it was.
    this.validateData(
      schema,
      Object.fromEntries(Object.entries(restored).filter(([, value]) => value !== null)),
      'create',
    );

    const result = await this.prisma.$transaction(async (tx) => {
      const current = (await getDelegate(tx, entity).findUnique({
        where: { [idField]: rowId },
      })) as Record<string, unknown> | null;
      // Routes are hard-deleted on retirement, so reverting one recreates the row.
      await this.validateEntityRules(entity, restored, current ? 'update' : 'create', rowId);
      if (restored.active === false) {
        this.assertCanRetire(entity, rowId);
      }
      const row = (
        current
          ? await getDelegate(tx, entity).update({ where: { [idField]: rowId }, data: restored })
          : await getDelegate(tx, entity).create({ data: restored })
      ) as Record<string, unknown>;
      const newRevision = await this.createRevision(
        actor,
        entity,
        getEntityId(entity, row),
        current ? rowToJson(current) : null,
        rowToJson(row),
        reason,
        tx,
      );
      return { row, revision: newRevision };
    });

    await this.publishChange(entity);
    return result.revision;
  }

  private resolveSchema(entity: string): EntitySchema {
    const schema = getEntitySchema(entity);
    if (!schema) {
      throw new GameConfigValidationError(`Unknown entity: ${entity}`, [
        { key: entity, message: 'Unknown entity' },
      ]);
    }
    return schema;
  }

  private validateData(
    schema: EntitySchema,
    data: Record<string, unknown>,
    mode: 'create' | 'update',
  ): Record<string, unknown> {
    const validator = buildEntityValidator(schema, mode);
    const result = validator.safeParse(data);
    if (!result.success) {
      const issues = buildZodIssues(result.error);
      throw new GameConfigValidationError(`Invalid ${schema.entity} payload`, issues);
    }
    return result.data;
  }

  private async validateEntityRules(
    entity: string,
    data: Record<string, unknown>,
    mode: 'create' | 'update',
    existingId?: string,
  ): Promise<void> {
    if (entity === 'routes') {
      await this.validateRoute(data, mode);
    }
    if (entity === 'factions') {
      await this.validateFactionRelations(data, mode, existingId);
    }
    if (entity === 'mission-templates' && data.factionId !== undefined) {
      await this.validateFactionExists(data.factionId as string);
    }
  }

  private async validateRoute(
    data: Record<string, unknown>,
    mode: 'create' | 'update',
  ): Promise<void> {
    const nodeAId = data.nodeAId;
    const nodeBId = data.nodeBId;
    if (nodeAId === undefined || nodeBId === undefined) return;

    const a = nodeAId as string;
    const b = nodeBId as string;
    if (a >= b) {
      throw new GameConfigValidationError('Route node ids must be ordered (nodeAId < nodeBId)', [
        { key: 'nodeAId', message: 'nodeAId must be lexicographically smaller than nodeBId' },
      ]);
    }

    if (mode === 'create') {
      const locationA = await this.prisma.location.findUnique({ where: { id: a } });
      const locationB = await this.prisma.location.findUnique({ where: { id: b } });
      if (!locationA || !locationB) {
        throw new GameConfigValidationError('Route references a missing location', [
          { key: 'nodeAId', message: 'Location not found' },
        ]);
      }
    }
  }

  private async validateFactionRelations(
    data: Record<string, unknown>,
    mode: 'create' | 'update',
    factionId?: string,
  ): Promise<void> {
    const relations = data.relations as Record<string, string> | undefined;
    if (!relations) return;

    const currentFactionId = factionId ?? (data.id as string);
    if (!currentFactionId) return;

    const otherFactionIds = Object.keys(relations).filter((id) => id !== currentFactionId);
    const otherFactions = await this.prisma.faction.findMany({
      where: { id: { in: otherFactionIds } },
    });
    const otherById = new Map(otherFactions.map((f) => [f.id, f]));

    for (const [otherId, relation] of Object.entries(relations)) {
      if (otherId === currentFactionId) continue;
      const other = otherById.get(otherId);
      if (!other) {
        throw new GameConfigValidationError(
          `Faction relation references unknown faction: ${otherId}`,
          [{ key: `relations.${otherId}`, message: 'Unknown faction' }],
        );
      }
      const otherRelations = other.relations as Record<string, string> | undefined;
      if (relation === 'hostile' || relation === 'ally') {
        if (otherRelations?.[currentFactionId] !== relation) {
          throw new GameConfigValidationError(
            `Faction relations must be symmetric: ${currentFactionId} -> ${otherId} is ${relation} but ${otherId} -> ${currentFactionId} is ${otherRelations?.[currentFactionId] ?? 'missing'}`,
            [{ key: `relations.${otherId}`, message: 'Asymmetric faction relation' }],
          );
        }
      }
    }
  }

  private async validateFactionExists(factionId: string): Promise<void> {
    const faction = await this.prisma.faction.findUnique({ where: { id: factionId } });
    if (!faction) {
      throw new GameConfigValidationError(`Faction not found: ${factionId}`, [
        { key: 'factionId', message: 'Faction not found' },
      ]);
    }
  }

  private assertCanRetire(entity: string, id: string): void {
    const rules = this.gameConfigService.snapshot().rules;
    if (entity === 'parts') {
      const starterParts = rules.onboarding.starter_parts as string[];
      if (starterParts.includes(id)) {
        throw new GameConfigValidationError(`Starter part ${id} cannot be retired`, [
          { key: id, message: 'STARTER_PART_REQUIRED' },
        ]);
      }
    }
  }

  private async graphWouldDisconnect(routeIdToRemove: string): Promise<boolean> {
    const locations = await this.prisma.location.findMany({ select: { id: true } });
    const routes = await this.prisma.route.findMany({
      where: { id: { not: routeIdToRemove } },
      select: { nodeAId: true, nodeBId: true },
    });

    if (locations.length === 0) return false;

    const adjacency = new Map<string, string[]>();
    for (const { id } of locations) {
      adjacency.set(id, []);
    }
    for (const { nodeAId, nodeBId } of routes) {
      adjacency.set(nodeAId, [...(adjacency.get(nodeAId) ?? []), nodeBId]);
      adjacency.set(nodeBId, [...(adjacency.get(nodeBId) ?? []), nodeAId]);
    }

    const start = locations[0]!.id;
    const visited = new Set<string>();
    const queue = [start];
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);
      for (const neighbor of adjacency.get(current) ?? []) {
        if (!visited.has(neighbor)) queue.push(neighbor);
      }
    }

    return visited.size !== locations.length;
  }

  async assertRouteDeletionSafe(routeId: string): Promise<void> {
    if (await this.graphWouldDisconnect(routeId)) {
      throw new GameConfigValidationError('Removing this route would disconnect the map', [
        { key: routeId, message: 'ROUTE_WOULD_DISCONNECT' },
      ]);
    }
  }

  private createRevision(
    actor: string,
    entityType: string,
    entityId: string,
    before: Record<string, unknown> | null,
    after: Record<string, unknown>,
    reason: string,
    tx: Prisma.TransactionClient,
  ): Promise<TuningRevision> {
    return this.gameConfigRepository.createRevision(
      {
        actor,
        entityType,
        entityId,
        before: before as Prisma.InputJsonValue,
        after: after as Prisma.InputJsonValue,
        reason,
      },
      tx,
    );
  }

  private serializeRow(
    row: Record<string, unknown>,
    schema: EntitySchema,
  ): Record<string, unknown> {
    const serialized: Record<string, unknown> = {};
    for (const field of schema.fields) {
      if (field.name in row) {
        serialized[field.name] = row[field.name];
      }
    }
    return serialized;
  }

  private async publishChange(entity: string): Promise<void> {
    await this.redis
      .publish(ENTITY_CHANGE_CHANNEL, JSON.stringify({ entity }))
      .catch(() => undefined);
  }
}
