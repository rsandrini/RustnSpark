import { Injectable } from '@nestjs/common';
import type { TuningRevision } from '@prisma/client';
import { GameConfigRepository } from '../../config/game-config.repository.js';

@Injectable()
export class RevisionService {
  constructor(private readonly gameConfigRepository: GameConfigRepository) {}

  async findById(id: bigint): Promise<TuningRevision | null> {
    return this.gameConfigRepository.findRevisionById(id);
  }

  async list(
    filters: { entityType?: string; entityId?: string; limit?: number; offset?: number } = {},
  ): Promise<TuningRevision[]> {
    const limit = Math.min(filters.limit ?? 50, 200);
    return this.gameConfigRepository.findRevisionsPaginated({ ...filters, limit });
  }
}
