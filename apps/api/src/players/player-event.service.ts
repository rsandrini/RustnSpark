import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

// Event writes carry a machine-readable `type` (e.g. wallet.debit) that later forensics,
// replay tooling and the Admin UI filter on; a blank type would poison that, so it is rejected
// here at the service boundary rather than relying on every caller to remember.
export class InvalidPlayerEventError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidPlayerEventError';
  }
}

export function assertValidEventType(type: string): void {
  if (typeof type !== 'string' || type.trim() === '') {
    throw new InvalidPlayerEventError('player event type must be a non-empty string');
  }
}

export interface RecordPlayerEventInput {
  playerId: string;
  type: string;
  creditsDelta?: number;
  payload?: Prisma.InputJsonValue;
}

@Injectable()
export class PlayerEventService {
  constructor(private readonly prisma: PrismaService) {}

  // `tx` stays optional so callers without an open transaction can record a standalone event;
  // WalletService always passes its own so the event commits/rolls back with the balance change.
  async record(input: RecordPlayerEventInput, tx?: Prisma.TransactionClient): Promise<void> {
    assertValidEventType(input.type);
    const client = tx ?? this.prisma;
    await client.playerEvent.create({
      data: {
        playerId: input.playerId,
        type: input.type,
        creditsDelta: input.creditsDelta,
        payload: input.payload,
      },
    });
  }
}
