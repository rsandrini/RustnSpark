import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '../common/decorators/current-user.decorator.js';
import { MiningJobService } from './mining-job.service.js';
import { StartMiningDto } from './dto/start-mining.dto.js';

// Starts an independent mining job at the ship's own location (a free MINING mission); the body
// only says how many ticks to dig. The result is decided by the seeded resolver when the job ends, never by the client.
@Controller('locations')
export class MiningJobController {
  constructor(private readonly jobs: MiningJobService) {}

  @Get(':id/mine/info')
  info(@Param('id') locationId: string) {
    return this.jobs.info(locationId);
  }

  @Post(':id/mine')
  @HttpCode(HttpStatus.OK)
  start(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') locationId: string,
    @Body() dto: StartMiningDto,
  ) {
    return this.jobs.start(user.playerId, locationId, dto.ticks);
  }
}
