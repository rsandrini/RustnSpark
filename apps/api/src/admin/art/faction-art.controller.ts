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
import { ART_SLOTS, FactionArtService, type ArtSlot } from './faction-art.service.js';

function slotOf(raw: string): ArtSlot {
  if (!(ART_SLOTS as readonly string[]).includes(raw)) {
    throw new BadRequestException({ error: 'ART_UNKNOWN_SLOT' });
  }
  return raw as ArtSlot;
}

@UseGuards(AdminGuard)
@Controller('admin/tuning/factions')
export class FactionArtAdminController {
  constructor(private readonly art: FactionArtService) {}

  // The body is the image itself (raw bytes, parsed by the image-only raw parser in configureApp).
  @Post(':id/art/:slot')
  @HttpCode(200)
  async upload(
    @Param('id') id: string,
    @Param('slot') slot: string,
    @Req() request: Request,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ slot: ArtSlot; url: string }> {
    const body: unknown = request.body;
    if (!Buffer.isBuffer(body)) throw new BadRequestException({ error: 'ART_UNSUPPORTED_TYPE' });
    const mime = (request.headers['content-type'] ?? '').split(';')[0]?.trim() ?? '';
    return this.art.upload(id, slotOf(slot), body, mime, user.accountId);
  }

  @Delete(':id/art/:slot')
  async reset(
    @Param('id') id: string,
    @Param('slot') slot: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ slot: ArtSlot; url: null }> {
    return this.art.reset(id, slotOf(slot), user.accountId);
  }
}
