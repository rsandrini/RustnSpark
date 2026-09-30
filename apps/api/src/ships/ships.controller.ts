import { ThrottleRoute } from '../common/decorators/throttle-route.decorator.js';
import { PREVIEW_POLICY } from '../common/throttling/policies.js';
import {
  Body,
  Controller,
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
import { ShipsService } from './ships.service.js';
import { AssembleDto, AutoAssembleDto, PreviewDto, StanceDto } from './dto/ship-operations.dto.js';

@Controller('ships')
export class ShipsController {
  constructor(private readonly shipsService: ShipsService) {}

  @Get()
  list(@CurrentUser() user: CurrentUserPayload) {
    return this.shipsService.findByPlayer(user.playerId);
  }

  @Get(':id')
  @UseGuards(OwnershipGuard)
  @OwnedResource({ type: 'ship', param: 'id' })
  get(@Param('id') shipId: string) {
    return this.shipsService.findById(shipId);
  }

  @Post(':id/assemble')
  @HttpCode(HttpStatus.OK)
  @UseGuards(OwnershipGuard)
  @OwnedResource({ type: 'ship', param: 'id' })
  assemble(@Param('id') shipId: string, @Body() dto: AssembleDto) {
    return this.shipsService.assemble(shipId, dto.layout);
  }

  @Post(':id/auto-assemble')
  @HttpCode(HttpStatus.OK)
  @UseGuards(OwnershipGuard)
  @OwnedResource({ type: 'ship', param: 'id' })
  autoAssemble(@Param('id') shipId: string, @Body() dto: AutoAssembleDto) {
    return this.shipsService.autoAssemble(shipId, dto.partInstanceIds);
  }

  @Post(':id/preview')
  @ThrottleRoute(PREVIEW_POLICY)
  @HttpCode(HttpStatus.OK)
  @UseGuards(OwnershipGuard)
  @OwnedResource({ type: 'ship', param: 'id' })
  preview(@Param('id') shipId: string, @Body() dto: PreviewDto) {
    return this.shipsService.preview(
      shipId,
      dto.layout,
      dto.partInstanceIds,
      dto.virtualPart,
      dto.replacePartInstanceId,
    );
  }

  @Post(':id/stance')
  @HttpCode(HttpStatus.OK)
  @UseGuards(OwnershipGuard)
  @OwnedResource({ type: 'ship', param: 'id' })
  stance(@Param('id') shipId: string, @Body() dto: StanceDto) {
    return this.shipsService.setStance(shipId, dto.stance);
  }
}
