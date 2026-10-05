import { Controller, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '../common/decorators/current-user.decorator.js';
import { MiningJobService } from './mining-job.service.js';

// Starts an independent mining job at the ship's own location (a free MINING mission). No
// body: the result is decided by the seeded resolver when the job ends, never by the client.
@Controller('locations')
export class MiningJobController {
  constructor(private readonly jobs: MiningJobService) {}

  @Post(':id/mine')
  @HttpCode(HttpStatus.OK)
  start(@CurrentUser() user: CurrentUserPayload, @Param('id') locationId: string) {
    return this.jobs.start(user.playerId, locationId);
  }
}
