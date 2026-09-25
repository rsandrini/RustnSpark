import { describe, expect, it, jest } from '@jest/globals';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { AdminAuditService } from '../audit/admin-audit.service.js';
import { MAINTENANCE_FLAG_KEY, SystemFlagService } from './system-flag.service.js';

function makeFixture() {
  const prismaFindUnique = jest.fn<(args: unknown) => Promise<unknown>>();
  const txFindUnique = jest.fn<(args: unknown) => Promise<unknown>>();
  const txUpsert = jest.fn<(args: unknown) => Promise<unknown>>();
  const findMany = jest.fn<(args: unknown) => Promise<unknown[]>>();
  const record = jest.fn<(entry: unknown, tx?: unknown) => Promise<unknown>>();

  const tx = { systemFlag: { findUnique: txFindUnique, upsert: txUpsert } };
  const prisma = {
    systemFlag: { findUnique: prismaFindUnique, findMany },
    $transaction: jest.fn((fn: (client: unknown) => Promise<unknown>) => fn(tx)),
  } as unknown as PrismaService;
  const audit = { record } as unknown as AdminAuditService;

  return {
    service: new SystemFlagService(prisma, audit),
    prismaFindUnique,
    txFindUnique,
    txUpsert,
    findMany,
    record,
    tx,
  };
}

describe('SystemFlagService (S11.2)', () => {
  it('reads the stored value', async () => {
    const { service, prismaFindUnique } = makeFixture();
    prismaFindUnique.mockResolvedValueOnce({ key: 'x', value: false });

    await expect(service.isEnabled('x', true)).resolves.toBe(false);
    expect(prismaFindUnique).toHaveBeenCalledWith({ where: { key: 'x' } });
  });

  it('falls back when the flag row does not exist yet', async () => {
    const { service, prismaFindUnique } = makeFixture();
    prismaFindUnique.mockResolvedValueOnce(null);

    await expect(service.isEnabled(MAINTENANCE_FLAG_KEY, false)).resolves.toBe(false);
    prismaFindUnique.mockResolvedValueOnce(null);
    await expect(service.isEnabled('register.open', true)).resolves.toBe(true);
  });

  it('creates a missing flag and audits before=null, after=value in the same transaction', async () => {
    const { service, txFindUnique, txUpsert, record, tx } = makeFixture();
    txFindUnique.mockResolvedValueOnce(null);
    txUpsert.mockResolvedValueOnce({ key: 'x', value: true });

    const flag = await service.setFlag('x', true, { actor: 'admin-1', ip: '10.0.0.1' });

    expect(flag).toEqual({ key: 'x', value: true });
    expect(txFindUnique).toHaveBeenCalledWith({ where: { key: 'x' } });
    expect(txUpsert).toHaveBeenCalledWith({
      where: { key: 'x' },
      create: { key: 'x', value: true, updatedBy: 'admin-1' },
      update: { value: true, updatedBy: 'admin-1' },
    });
    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith(
      {
        actor: 'admin-1',
        action: 'FLAG_SET',
        target: 'x',
        before: null,
        after: true,
        ip: '10.0.0.1',
      },
      tx,
    );
  });

  it('audits the previous value when toggling an existing flag', async () => {
    const { service, txFindUnique, record } = makeFixture();
    txFindUnique.mockResolvedValueOnce({ key: MAINTENANCE_FLAG_KEY, value: true });

    await service.setFlag(MAINTENANCE_FLAG_KEY, false, { actor: 'admin-1' });

    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        target: MAINTENANCE_FLAG_KEY,
        before: true,
        after: false,
        ip: null,
      }),
      expect.anything(),
    );
  });

  it('passes a custom audit action through', async () => {
    const { service, txFindUnique, record } = makeFixture();
    txFindUnique.mockResolvedValueOnce(null);

    await service.setFlag('x', true, { actor: 'a', action: 'CUSTOM_ACTION' });

    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'CUSTOM_ACTION' }),
      expect.anything(),
    );
  });

  it('lists flags ordered by key', async () => {
    const { service, findMany } = makeFixture();
    findMany.mockResolvedValueOnce([]);

    await service.list();

    expect(findMany).toHaveBeenCalledWith({ orderBy: { key: 'asc' } });
  });
});
