import { Controller, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '../common/decorators/current-user.decorator.js';
import { ScavengeJobService } from './scavenge-job.service.js';

// Starts a scavenging job at the ship's own port (a mission of type SCAVENGE). No body: the
// result is decided by the seeded resolver when the job ends, never by the client.
@Controller('locations')
export class ScavengeJobController {
  constructor(private readonly jobs: ScavengeJobService) {}

  @Post(':id/scavenge')
  @HttpCode(HttpStatus.OK)
  start(@CurrentUser() user: CurrentUserPayload, @Param('id') locationId: string) {
    return this.jobs.start(user.playerId, locationId);
  }
}
