import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Patch,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import type { TuningRevision } from '@prisma/client';
import { AdminGuard } from '../guards/admin.guard.js';
import { ConfigTuningApiError, ConfigTuningApiErrorFilter } from './config-tuning-error.filter.js';
import { ConfigTuningService, RevisionMismatchError } from './config-tuning.service.js';
import { CreateEntityDto, RetireEntityDto, RevertRevisionDto, UpdateEntityDto } from './dto/index.js';
import { EntityTuningService } from './entity-tuning.service.js';
import { CurrentUser, type CurrentUserPayload } from '../../common/decorators/current-user.decorator.js';
import { GameConfigValidationError } from '../../config/game-config.types.js';

function serializeRevision(revision: TuningRevision): Record<string, unknown> {
  return {
    ...revision,
    id: revision.id.toString(),
  };
}

@UseGuards(AdminGuard)
@UseFilters(ConfigTuningApiErrorFilter)
@Controller('admin/tuning')
export class EntityTuningController {
  constructor(
    private readonly entityTuningService: EntityTuningService,
    private readonly configTuningService: ConfigTuningService,
  ) {}

  @Get('schema/:entity')
  getSchema(@Param('entity') entity: string): Record<string, unknown> {
    return this.entityTuningService.getSchema(entity);
  }

  @Get(':entity')
  async list(@Param('entity') entity: string): Promise<Record<string, unknown>[]> {
    return this.entityTuningService.list(entity);
  }

  @Get(':entity/:id')
  async getOne(
    @Param('entity') entity: string,
    @Param('id') id: string,
  ): Promise<Record<string, unknown>> {
    const row = await this.entityTuningService.getById(entity, id);
    if (!row) throw new NotFoundException(`${entity} ${id} not found`);
    return row;
  }

  @Post(':entity')
  async create(
    @Param('entity') entity: string,
    @Body() dto: CreateEntityDto,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<Record<string, unknown>> {
    try {
      const result = await this.entityTuningService.create(entity, dto.data, user.accountId, dto.reason);
      return { row: result.row, revision: serializeRevision(result.revision) };
    } catch (error) {
      this.rethrowAsApiError(error);
      throw error;
    }
  }

  @Patch(':entity/:id')
  async update(
    @Param('entity') entity: string,
    @Param('id') id: string,
    @Body() dto: UpdateEntityDto,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<Record<string, unknown>> {
    try {
      const result = await this.entityTuningService.update(entity, id, dto.data, user.accountId, dto.reason);
      return { row: result.row, revision: serializeRevision(result.revision) };
    } catch (error) {
      this.rethrowAsApiError(error);
      throw error;
    }
  }

  @Delete(':entity/:id')
  @HttpCode(200)
  async retire(
    @Param('entity') entity: string,
    @Param('id') id: string,
    @Body() dto: RetireEntityDto,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<Record<string, unknown>> {
    try {
      const result = await this.entityTuningService.retire(entity, id, user.accountId, dto.reason);
      return { row: result.row, revision: serializeRevision(result.revision) };
    } catch (error) {
      this.rethrowAsApiError(error);
      throw error;
    }
  }

  @Post('revisions/:id/revert')
  @HttpCode(200)
  async revertRevision(
    @Param('id') id: string,
    @Body() dto: RevertRevisionDto,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<Record<string, unknown>> {
    try {
      const revision = await this.entityTuningService.revertRevision(BigInt(id), user.accountId, dto.reason);
      return serializeRevision(revision);
    } catch (error) {
      this.rethrowAsApiError(error);
      throw error;
    }
  }

  private rethrowAsApiError(error: unknown): void {
    if (error instanceof GameConfigValidationError) {
      const code = error.issues[0]?.message;
      throw new ConfigTuningApiError(
        {
          error: 'VALIDATION_ERROR',
          code: ['STARTER_PART_REQUIRED', 'ROUTE_WOULD_DISCONNECT', 'HOME_LOCATION_REQUIRED'].includes(
            code ?? '',
          )
            ? code
            : undefined,
          issues: error.issues.map((issue) => ({ key: issue.key, message: issue.message })),
        },
        400,
      );
    }
    if (error instanceof RevisionMismatchError) {
      throw new ConfigTuningApiError(
        { error: 'REVISION_MISMATCH', currentRevision: error.currentRevision },
        409,
      );
    }
  }
}
