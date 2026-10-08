import {
  BadRequestException,
  Controller,
  Delete,
  HttpCode,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '../../common/decorators/current-user.decorator.js';
import { AdminGuard } from '../guards/admin.guard.js';
import { ArtService, type ArtKind } from './art.service.js';

// Admin upload / reset of an entity's images. The body of an upload is the image itself (raw bytes,
// parsed by the image-only raw parser in configureApp).
@UseGuards(AdminGuard)
@Controller('admin/tuning')
export class ArtAdminController {
  constructor(private readonly art: ArtService) {}

  @Post('factions/:id/art/:slot')
  @HttpCode(200)
  uploadFaction(
    @Param('id') id: string,
    @Param('slot') slot: string,
    @Req() request: Request,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ slot: string; url: string }> {
    return this.upload('factions', id, slot, request, user);
  }

  @Post('locations/:id/art/:slot')
  @HttpCode(200)
  uploadLocation(
    @Param('id') id: string,
    @Param('slot') slot: string,
    @Req() request: Request,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ slot: string; url: string }> {
    return this.upload('locations', id, slot, request, user);
  }

  @Delete('factions/:id/art/:slot')
  resetFaction(
    @Param('id') id: string,
    @Param('slot') slot: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ slot: string; url: null }> {
    return this.art.reset('factions', id, slot, user.accountId);
  }

  @Delete('locations/:id/art/:slot')
  resetLocation(
    @Param('id') id: string,
    @Param('slot') slot: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ slot: string; url: null }> {
    return this.art.reset('locations', id, slot, user.accountId);
  }

  private upload(
    kind: ArtKind,
    id: string,
    slot: string,
    request: Request,
    user: CurrentUserPayload,
  ): Promise<{ slot: string; url: string }> {
    const body: unknown = request.body;
    if (!Buffer.isBuffer(body)) throw new BadRequestException({ error: 'ART_UNSUPPORTED_TYPE' });
    const mime = (request.headers['content-type'] ?? '').split(';')[0]?.trim() ?? '';
    return this.art.upload(kind, id, slot, body, mime, user.accountId);
  }
}
