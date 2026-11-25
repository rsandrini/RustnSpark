import { ShipProfileDetailSchema, ShipResponseSchema } from '@rustandspark/contract';
import { describe, expect, it } from 'vitest';
import { sandboxInterceptor } from '../../features/prologue/sandbox/sandbox-api';
import { createSandbox } from '../../features/prologue/sandbox/sandbox-state';

const DETAIL = Object.fromEntries(
  ['cargo', 'passengers', 'firepower', 'defense', 'mobility', 'range', 'mining'].map((key) => [
    key,
    { value: 1, ref: 10 },
  ]),
);

describe('ShipProfileDetailSchema on the ship response', () => {
  it('parses a ship with and without profileDetail', async () => {
    const sandbox = createSandbox({
      payouts: [646, 494, 2660],
      purse: 300,
      refuelCost: 100,
      moduleCost: 800,
      upgradeCost: 200,
      repairCost: 150,
      profile: { id: 'player-1', name: 'Test Pilot', locale: 'en', role: 'PLAYER' as const },
    });
    const answer = await sandboxInterceptor(sandbox)({
      method: 'GET',
      path: '/v1/ships/prologue-ship',
      body: undefined,
    });
    if (!answer.handled) throw new Error('not handled');
    const ship = answer.value as Record<string, unknown>;
    expect(ShipResponseSchema.safeParse(ship).success).toBe(true);
    expect(ShipResponseSchema.safeParse({ ...ship, profileDetail: DETAIL }).success).toBe(true);
    expect(ShipProfileDetailSchema.safeParse({ cargo: { value: 1, ref: 1 } }).success).toBe(false);
  });
});
