import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '../common/decorators/current-user.decorator.js';
import { OwnedResource } from '../common/decorators/owned-resource.decorator.js';
import { OwnershipGuard } from '../common/guards/ownership.guard.js';
import { AcceptMissionDto } from './dto/accept.dto.js';
import { DispatchMissionDto } from './dto/dispatch.dto.js';
import { DispatchService } from './dispatch.service.js';
import { MissionsService } from './missions.service.js';

// Default-deny (R28): no @Public() anywhere, the player comes from token claims.
// Paths are relative to the global `v1` prefix (main.ts).
@Controller()
export class MissionsController {
  constructor(
    private readonly missions: MissionsService,
    private readonly dispatchService: DispatchService,
  ) {}

  @Get('locations/:id/missions')
  getBoard(@CurrentUser() user: CurrentUserPayload, @Param('id') locationId: string) {
    return this.missions.getBoard(locationId, user.playerId);
  }

  @Get('missions/active')
  getActive(@CurrentUser() user: CurrentUserPayload) {
    return this.missions.getActive(user.playerId);
  }

  @Post('missions/:id/accept')
  @HttpCode(HttpStatus.OK)
  accept(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') missionId: string,
    @Body() dto: AcceptMissionDto,
  ) {
    return this.missions.accept(missionId, user.playerId, dto.shipId);
  }

  @Post('missions/:id/hold')
  @HttpCode(HttpStatus.OK)
  hold(@CurrentUser() user: CurrentUserPayload, @Param('id') missionId: string) {
    return this.missions.hold(missionId, user.playerId);
  }

  @Delete('missions/:id/hold')
  @HttpCode(HttpStatus.OK)
  releaseHold(@CurrentUser() user: CurrentUserPayload, @Param('id') missionId: string) {
    return this.missions.release(missionId, user.playerId);
  }

  @Post('ships/:id/dispatch')
  @HttpCode(HttpStatus.OK)
  @UseGuards(OwnershipGuard)
  @OwnedResource({ type: 'ship', param: 'id' })
  dispatch(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') shipId: string,
    @Body() dto: DispatchMissionDto,
  ) {
    return this.dispatchService.dispatch(shipId, dto.missionId, user.playerId);
  }
}
