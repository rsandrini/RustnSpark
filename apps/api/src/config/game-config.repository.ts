import { Injectable } from '@nestjs/common';
import type { GameConfig, Prisma, RulesSnapshot, TuningRevision } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class GameConfigRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(tx?: Prisma.TransactionClient): Promise<GameConfig[]> {
    const client = tx ?? this.prisma;
    return client.gameConfig.findMany();
  }

  async findByKey(key: string, tx?: Prisma.TransactionClient): Promise<GameConfig | null> {
    const client = tx ?? this.prisma;
    return client.gameConfig.findUnique({ where: { key } });
  }

  async upsert(
    key: string,
    value: unknown,
    type: string,
    description: Record<string, string>,
    updatedBy: string,
    tx?: Prisma.TransactionClient,
  ): Promise<GameConfig> {
    const client = tx ?? this.prisma;
    const jsonValue = value as Prisma.InputJsonValue;
    return client.gameConfig.upsert({
      where: { key },
      create: { key, value: jsonValue, type, description, updatedBy },
      update: { value: jsonValue, type, description, updatedBy },
    });
  }

  async findSnapshotByHash(
    hash: string,
    tx?: Prisma.TransactionClient,
  ): Promise<RulesSnapshot | null> {
    const client = tx ?? this.prisma;
    return client.rulesSnapshot.findUnique({ where: { hash } });
  }

  async findLatestSnapshot(tx?: Prisma.TransactionClient): Promise<RulesSnapshot | null> {
    const client = tx ?? this.prisma;
    return client.rulesSnapshot.findFirst({ orderBy: { createdAt: 'desc' } });
  }

  async createSnapshot(
    hash: string,
    rules: Record<string, unknown>,
    tx?: Prisma.TransactionClient,
  ): Promise<RulesSnapshot> {
    const client = tx ?? this.prisma;
    return client.rulesSnapshot.create({ data: { hash, rules: rules as Prisma.InputJsonValue } });
  }

  async createRevision(
    data: Omit<Prisma.TuningRevisionCreateInput, 'id'>,
    tx?: Prisma.TransactionClient,
  ): Promise<TuningRevision> {
    const client = tx ?? this.prisma;
    return client.tuningRevision.create({ data });
  }

  async findLatestRevision(tx?: Prisma.TransactionClient): Promise<TuningRevision | null> {
    const client = tx ?? this.prisma;
    return client.tuningRevision.findFirst({ orderBy: { id: 'desc' } });
  }

  async findRevisions(
    filters: { entityType?: string; entityId?: string } = {},
    tx?: Prisma.TransactionClient,
  ): Promise<TuningRevision[]> {
    const client = tx ?? this.prisma;
    const where: Prisma.TuningRevisionWhereInput = {};
    if (filters.entityType) where.entityType = filters.entityType;
    if (filters.entityId) where.entityId = filters.entityId;
    return client.tuningRevision.findMany({ where, orderBy: { id: 'desc' } });
  }

  async findRevisionsPaginated(
    filters: { entityType?: string; entityId?: string; limit?: number; offset?: number } = {},
    tx?: Prisma.TransactionClient,
  ): Promise<TuningRevision[]> {
    const client = tx ?? this.prisma;
    const where: Prisma.TuningRevisionWhereInput = {};
    if (filters.entityType) where.entityType = filters.entityType;
    if (filters.entityId) where.entityId = filters.entityId;
    const take = filters.limit;
    const skip = filters.offset;
    return client.tuningRevision.findMany({ where, orderBy: { id: 'desc' }, take, skip });
  }

  async findRevisionById(
    id: bigint,
    tx?: Prisma.TransactionClient,
  ): Promise<TuningRevision | null> {
    const client = tx ?? this.prisma;
    return client.tuningRevision.findUnique({ where: { id } });
  }
}
