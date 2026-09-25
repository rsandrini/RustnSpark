import { describe, expect, it, jest } from '@jest/globals';
import { NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { AdminAuditService } from '../audit/admin-audit.service.js';
import { SystemNoticeService, type NoticeMessage } from './system-notice.service.js';

const MESSAGE: NoticeMessage = { en: 'Server party', 'pt-BR': 'Festa no servidor' };

function makeFixture() {
  const txCreate = jest.fn<(args: unknown) => Promise<unknown>>();
  const txFindUnique = jest.fn<(args: unknown) => Promise<unknown>>();
  const txUpdate = jest.fn<(args: unknown) => Promise<unknown>>();
  const findMany = jest.fn<(args: unknown) => Promise<unknown[]>>();
  const record = jest.fn<(entry: unknown, tx?: unknown) => Promise<unknown>>();

  const tx = { systemNotice: { create: txCreate, findUnique: txFindUnique, update: txUpdate } };
  const prisma = {
    systemNotice: { findMany },
    $transaction: jest.fn((fn: (client: unknown) => Promise<unknown>) => fn(tx)),
  } as unknown as PrismaService;
  const audit = { record } as unknown as AdminAuditService;

  return {
    service: new SystemNoticeService(prisma, audit),
    txCreate,
    txFindUnique,
    txUpdate,
    findMany,
    record,
    tx,
  };
}

describe('SystemNoticeService (S11.2)', () => {
  it('creates a notice and audits BROADCAST_CREATE in the same transaction', async () => {
    const { service, txCreate, record, tx } = makeFixture();
    txCreate.mockResolvedValueOnce({ id: 'n1', active: true });

    const notice = await service.create(MESSAGE, { actor: 'admin-1', ip: '10.0.0.2' });

    expect(notice).toEqual({ id: 'n1', active: true });
    expect(txCreate).toHaveBeenCalledWith({
      data: { message: expect.objectContaining({ en: 'Server party' }), createdBy: 'admin-1' },
    });
    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith(
      {
        actor: 'admin-1',
        action: 'BROADCAST_CREATE',
        target: 'n1',
        before: null,
        after: { message: MESSAGE, active: true },
        ip: '10.0.0.2',
      },
      tx,
    );
  });

  it('serves only active notices, newest first', async () => {
    const { service, findMany } = makeFixture();
    findMany.mockResolvedValueOnce([]);

    await service.listActive();

    expect(findMany).toHaveBeenCalledWith({
      where: { active: true },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('dismisses an active notice with a BROADCAST_DISMISS audit row', async () => {
    const { service, txFindUnique, txUpdate, record } = makeFixture();
    txFindUnique.mockResolvedValueOnce({ id: 'n1', active: true });
    txUpdate.mockResolvedValueOnce({ id: 'n1', active: false });

    await service.dismiss('n1', { actor: 'admin-1' });

    expect(txUpdate).toHaveBeenCalledWith({
      where: { id: 'n1' },
      data: { active: false, dismissedAt: expect.any(Date) },
    });
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'BROADCAST_DISMISS',
        target: 'n1',
        before: { active: true },
        after: { active: false },
      }),
      expect.anything(),
    );
  });

  it('404s on an unknown notice and audits nothing when already dismissed', async () => {
    const { service, txFindUnique, txUpdate, record } = makeFixture();

    txFindUnique.mockResolvedValueOnce(null);
    await expect(service.dismiss('missing', { actor: 'a' })).rejects.toThrow(NotFoundException);

    txFindUnique.mockResolvedValueOnce({ id: 'n1', active: false });
    const result = await service.dismiss('n1', { actor: 'a' });
    expect(result.active).toBe(false);
    expect(txUpdate).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });
});
