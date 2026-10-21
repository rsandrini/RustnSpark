import { Module } from '@nestjs/common';
import { EconomyModule } from '../economy/economy.module.js';
import { DialogueController } from './dialogue.controller.js';
import { DialogueService } from './dialogue.service.js';

@Module({
  imports: [EconomyModule],
  controllers: [DialogueController],
  providers: [DialogueService],
})
export class DialogueModule {}
