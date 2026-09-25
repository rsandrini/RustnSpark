import { describe, expect, it, jest } from '@jest/globals';
import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { AdminAuditService } from './admin-audit.service.js';

type CreateArgs = { data: Record<string, unknown> };
type CreateResult = { id: bigint } & Record<string, unknown>;
type FindManyArgs = Record<string, unknown>;

function makeService() {
  const create = jest.fn<(args: CreateArgs) => Promise<CreateResult>>();
  const findMany = jest.fn<(args: FindManyArgs) => Promise<unknown[]>>();
  const prisma = { adminAuditLog: { create, findMany } } as unknown as PrismaService;
  return { service: new AdminAuditService(prisma), create, findMany };
}

describe('AdminAuditService (S11.1)', () => {
  it('stores actor, action, target, before/after and ip verbatim', async () => {
    const { service, create } = makeService();

    await service.record({
      actor: 'admin-account-1',
      action: 'SUPPORT_GRANT_CREDITS',
      target: 'player-1',
      before: { credits: 100 },
      after: { credits: 350 },
      ip: '203.0.113.9',
    });

    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]?.[0]).toEqual({
      data: {
        actor: 'admin-account-1',
        action: 'SUPPORT_GRANT_CREDITS',
        target: 'player-1',
        before: { credits: 100 },
        after: { credits: 350 },
        ip: '203.0.113.9',
      },
    });
  });

  it('omits json state and ip for a write that created its target', async () => {
    const { service, create } = makeService();

    await service.record({ actor: 'a', action: 'FLAG_SET', before: null, after: { on: true } });

    const data = create.mock.calls[0]?.[0].data;
    expect(data).toEqual({
      actor: 'a',
      action: 'FLAG_SET',
      target: null,
      before: undefined,
      after: { on: true },
      ip: null,
    });
  });

  it('audits inside the caller transaction when one is given', async () => {
    const txCreate = jest.fn<(args: CreateArgs) => Promise<CreateResult>>();
    const tx = { adminAuditLog: { create: txCreate } } as unknown as Prisma.TransactionClient;
    const { service, create } = makeService();

    await service.record({ actor: 'a', action: 'BROADCAST_CREATE' }, tx);

    expect(txCreate).toHaveBeenCalledTimes(1);
    expect(create).not.toHaveBeenCalled();
  });

  it('lists newest first with a default page of 50', async () => {
    const { service, findMany } = makeService();

    await service.list();

    expect(findMany.mock.calls[0]?.[0]).toEqual({
      where: {},
      orderBy: { id: 'desc' },
      take: 50,
      skip: 0,
    });
  });

  it('clamps the limit at 200 and applies action/target filters', async () => {
    const { service, findMany } = makeService();

    await service.list({ action: 'FLAG_SET', target: 'announce', limit: 999, offset: 10 });

    expect(findMany.mock.calls[0]?.[0]).toEqual({
      where: { action: 'FLAG_SET', target: 'announce' },
      orderBy: { id: 'desc' },
      take: 200,
      skip: 10,
    });
  });
});
