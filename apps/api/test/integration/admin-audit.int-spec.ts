import { afterAll, afterEach, beforeAll, describe, expect, it } from '@jest/globals';
import { AdminAuditService } from '../../src/admin/audit/admin-audit.service.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { createTestApp, type TestApp } from '../support/app-factory.js';
import { resetDatabase } from '../support/test-db.js';

// S11.1: the audit infrastructure every later admin write must use. The
// "every non-tuning write produces a row" acceptance is asserted at each write
// site as it lands (S11.2 flags/broadcast/maintenance, S11.4 support actions);
// this suite pins the shared record/list semantics those sites rely on.
describe('admin audit log (S11.1)', () => {
  let testApp: TestApp;
  let prisma: PrismaService;
  let audit: AdminAuditService;

  beforeAll(async () => {
    testApp = await createTestApp();
    prisma = testApp.app.get(PrismaService);
    audit = testApp.app.get(AdminAuditService);
  });

  afterAll(async () => {
    await testApp?.close();
  });

  afterEach(async () => {
    await resetDatabase(prisma);
  });

  it('persists actor, action, target, before/after state and ip', async () => {
    const row = await audit.record({
      actor: 'admin-account-1',
      action: 'SUPPORT_GRANT_CREDITS',
      target: 'player-1',
      before: { credits: 100 },
      after: { credits: 350 },
      ip: '203.0.113.9',
    });

    const stored = await prisma.adminAuditLog.findUnique({ where: { id: row.id } });
    expect(stored).not.toBeNull();
    expect(stored?.actor).toBe('admin-account-1');
    expect(stored?.action).toBe('SUPPORT_GRANT_CREDITS');
    expect(stored?.target).toBe('player-1');
    expect(stored?.ip).toBe('203.0.113.9');
    expect(stored?.before).toEqual({ credits: 100 });
    expect(stored?.after).toEqual({ credits: 350 });
    expect(stored?.at).toBeInstanceOf(Date);
  });

  it('stores NULL before/after for a write that created its target', async () => {
    await audit.record({ actor: 'a', action: 'FLAG_SET', target: 'announce', after: { on: true } });

    const [row] = await prisma.adminAuditLog.findMany();
    expect(row?.before).toBeNull();
    expect(row?.ip).toBeNull();
    expect(row?.after).toEqual({ on: true });
  });

  it('returns rows newest first and filters by action', async () => {
    await audit.record({ actor: 'a', action: 'FLAG_SET', target: 'one' });
    await audit.record({ actor: 'a', action: 'FLAG_SET', target: 'two' });
    await audit.record({ actor: 'a', action: 'BROADCAST_CREATE', target: 'notice-1' });

    const all = await audit.list();
    expect(all.map((row) => row.action)).toEqual(['BROADCAST_CREATE', 'FLAG_SET', 'FLAG_SET']);

    const flags = await audit.list({ action: 'FLAG_SET' });
    expect(flags).toHaveLength(2);
    expect(flags.map((row) => row.target)).toEqual(['two', 'one']);

    const scoped = await audit.list({ target: 'notice-1' });
    expect(scoped).toHaveLength(1);
    expect(scoped[0]?.action).toBe('BROADCAST_CREATE');
  });
});
