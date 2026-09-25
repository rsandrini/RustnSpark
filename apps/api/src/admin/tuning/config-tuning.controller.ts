import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import type { TuningRevision } from '@prisma/client';
import { AdminGuard } from '../guards/admin.guard.js';
import { BundleService, type BundleExport } from './bundle.service.js';
import { ConfigTuningApiError, ConfigTuningApiErrorFilter } from './config-tuning-error.filter.js';
import { ConfigTuningService, RevisionMismatchError } from './config-tuning.service.js';
import {
  ImportBundleDto,
  ResetConfigValueDto,
  UpdateConfigValueDto,
  type ConfigEntryResponse,
} from './dto/index.js';
import { RevisionService } from './revision.service.js';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '../../common/decorators/current-user.decorator.js';
import { GameConfigValidationError } from '../../config/game-config.types.js';

function serializeRevision(revision: TuningRevision): Record<string, unknown> {
  return {
    ...revision,
    id: revision.id.toString(),
  };
}

function serializeRevisions(revisions: TuningRevision[]): Record<string, unknown>[] {
  return revisions.map(serializeRevision);
}

@UseGuards(AdminGuard)
@UseFilters(ConfigTuningApiErrorFilter)
@Controller('admin/tuning')
export class ConfigTuningController {
  constructor(
    private readonly configTuningService: ConfigTuningService,
    private readonly revisionService: RevisionService,
    private readonly bundleService: BundleService,
  ) {}

  @Get('config')
  listConfig(): Promise<ConfigEntryResponse[]> {
    return this.configTuningService.list();
  }

  @Patch('config/:key')
  async updateConfig(
    @Param('key') key: string,
    @Body() dto: UpdateConfigValueDto,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<Record<string, unknown>> {
    try {
      const revision = await this.configTuningService.update(key, dto, user.accountId);
      return serializeRevision(revision);
    } catch (error) {
      this.rethrowAsApiError(error);
      throw error;
    }
  }

  @Post('config/:key/reset')
  @HttpCode(200)
  async resetConfig(
    @Param('key') key: string,
    @Body() dto: ResetConfigValueDto,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<Record<string, unknown>> {
    try {
      const revision = await this.configTuningService.reset(key, dto, user.accountId);
      return serializeRevision(revision);
    } catch (error) {
      this.rethrowAsApiError(error);
      throw error;
    }
  }

  @Get('revisions')
  async listRevisions(
    @Query('entityType') entityType?: string,
    @Query('entityId') entityId?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ): Promise<Record<string, unknown>[]> {
    const revisions = await this.revisionService.list({
      entityType,
      entityId,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
    return serializeRevisions(revisions);
  }

  @Get('bundle')
  exportBundle(): Promise<BundleExport> {
    return this.bundleService.export();
  }

  @Post('bundle')
  @HttpCode(200)
  async importBundle(
    @Body() dto: ImportBundleDto,
    @CurrentUser() user: CurrentUserPayload,
    @Query('dryRun') dryRun?: string,
  ): Promise<{ valid: true; diffs: unknown[] } | { revisions: Record<string, unknown>[] }> {
    try {
      if (dryRun === 'true') {
        return await this.bundleService.dryRun(dto.entries);
      }
      const revisions = await this.bundleService.import(dto.entries, user.accountId);
      return { revisions: revisions.map(serializeRevision) };
    } catch (error) {
      this.rethrowAsApiError(error);
      throw error;
    }
  }

  private rethrowAsApiError(error: unknown): void {
    if (error instanceof GameConfigValidationError) {
      throw new ConfigTuningApiError(
        {
          error: 'VALIDATION_ERROR',
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
