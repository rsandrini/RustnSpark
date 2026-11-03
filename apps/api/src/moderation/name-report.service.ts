import {
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../common/redis/redis.module.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { NameReportDto } from './dto/name-report.dto.js';

// Abuse control for reporting (infrastructure limits, not balance): a pilot files a few a day, and a report on the
// same pilot and subject waits for review before it can be filed again.
export const NAME_REPORT_DAILY_PER_PILOT = 10;
const DAY_SECONDS = 86_400;

@Injectable()
export class NameReportService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async create(reporterId: string, dto: NameReportDto): Promise<{ id: string }> {
    const target = await this.prisma.player.findUnique({ where: { name: dto.playerName } });
    if (target === null) throw new NotFoundException({ error: 'PLAYER_NOT_FOUND' });
    if (target.id === reporterId) throw new ConflictException({ error: 'CANNOT_REPORT_SELF' });

    let reportedText = target.name;
    if (dto.subject === 'SHIP_NAME') {
      const ship = await this.prisma.ship.findFirst({
        where: { ownerPlayerId: target.id },
        orderBy: { id: 'asc' },
        select: { name: true },
      });
      if (ship === null) throw new ConflictException({ error: 'NO_SHIP_TO_REPORT' });
      reportedText = ship.name;
    }

    await this.takeSlot(reporterId);
    try {
      const created = await this.prisma.nameReport.create({
        data: {
          reporterId,
          targetId: target.id,
          subject: dto.subject,
          reason: dto.reason,
          note: dto.note?.trim() === '' ? null : (dto.note?.trim() ?? null),
          reportedText: reportedText.slice(0, 80),
        },
        select: { id: true },
      });
      return created;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException({ error: 'ALREADY_REPORTED' });
      }
      throw error;
    }
  }

  private async takeSlot(reporterId: string): Promise<void> {
    const key = `namereport:${new Date().toISOString().slice(0, 10)}:${reporterId}`;
    const count = await this.redis.incr(key);
    if (count === 1) await this.redis.expire(key, DAY_SECONDS);
    if (count > NAME_REPORT_DAILY_PER_PILOT) {
      throw new HttpException({ error: 'REPORT_LIMIT' }, HttpStatus.TOO_MANY_REQUESTS);
    }
  }
}
