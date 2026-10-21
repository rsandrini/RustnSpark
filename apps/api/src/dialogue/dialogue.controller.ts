import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '../common/decorators/current-user.decorator.js';
import { DialogueEventDto, DialogueSettingsDto } from './dto/dialogue.dto.js';
import { DialogueService, type DialogueState } from './dialogue.service.js';

// No @Public(): the token names the pilot, like the rest of /players/me.
@Controller('players/me')
export class DialogueController {
  constructor(private readonly dialogue: DialogueService) {}

  @Get('dialogue')
  getState(@CurrentUser() user: CurrentUserPayload): Promise<DialogueState> {
    return this.dialogue.getState(user.playerId);
  }

  // Declared before `dialogue/:sceneId` so "settings" is never taken for a scene id.
  @Post('dialogue/settings')
  @HttpCode(200)
  async settings(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: DialogueSettingsDto,
  ): Promise<{ ok: true }> {
    await this.dialogue.setEnabled(user.playerId, dto.enabled);
    return { ok: true };
  }

  @Post('dialogue/:sceneId')
  @HttpCode(200)
  async record(
    @CurrentUser() user: CurrentUserPayload,
    @Param('sceneId') sceneId: string,
    @Body() dto: DialogueEventDto,
  ): Promise<{ ok: true }> {
    await this.dialogue.record(user.playerId, sceneId, dto.event, dto.nodeId);
    return { ok: true };
  }

  @Post('dialogue/:sceneId/replay')
  @HttpCode(200)
  async replay(
    @CurrentUser() user: CurrentUserPayload,
    @Param('sceneId') sceneId: string,
  ): Promise<{ ok: true }> {
    await this.dialogue.replay(user.playerId, sceneId);
    return { ok: true };
  }
}
