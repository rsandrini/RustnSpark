import { Controller, Get } from '@nestjs/common';
import type { SystemNotice } from '@prisma/client';
import { SystemNoticeService, type NoticeMessage } from './system-notice.service.js';

interface NoticeResponse {
  id: string;
  message: NoticeMessage;
}

// Player-facing reads for S11.2 (JWT by default): active broadcasts only. The rows are
// written through the admin controller, so what a player sees here is effective immediately.
@Controller('system')
export class SystemPublicController {
  constructor(private readonly notices: SystemNoticeService) {}

  @Get('notices')
  async listNotices(): Promise<{ items: NoticeResponse[] }> {
    const rows = await this.notices.listActive();
    return {
      // message is only ever written through CreateNoticeDto (bilingual), so the cast
      // reads stored JSON back as the shape it was validated into.
      items: rows.map((row: SystemNotice) => ({
        id: row.id,
        message: row.message as unknown as NoticeMessage,
      })),
    };
  }
}
