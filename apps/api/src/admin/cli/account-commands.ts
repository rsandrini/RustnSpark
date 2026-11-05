import type { Prisma, PrismaClient } from '@prisma/client';

/** The emergency account tool: what each subcommand does, kept apart from the Nest wiring so it can be tested. */
export const ACCOUNT_COMMANDS = [
  'show',
  'list-admins',
  'promote',
  'demote',
  'ban',
  'unban',
  'set-password',
] as const;
export type AccountCommand = (typeof ACCOUNT_COMMANDS)[number];

export interface AccountCommandArgs {
  email?: string | undefined;
  password?: string | undefined;
  force?: boolean | undefined;
}

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;
/** Who the audit log names as the actor when a change is made from the server shell. */
export const CLI_ACTOR = 'cli';

type Db = Pick<PrismaClient, 'account' | 'refreshToken' | 'adminAuditLog' | '$transaction'>;

export async function runAccountCommand(
  prisma: Db,
  hash: (plain: string) => Promise<string>,
  command: AccountCommand,
  args: AccountCommandArgs,
): Promise<Record<string, unknown>> {
  if (command === 'list-admins') {
    const admins = await prisma.account.findMany({
      where: { role: 'ADMIN' },
      select: { email: true, status: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
    return { admins };
  }

  if (!args.email) throw new Error('--email is required');
  const email = args.email.toLowerCase().trim();
  const account = await prisma.account.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      role: true,
      status: true,
      createdAt: true,
      player: { select: { name: true } },
    },
  });
  if (!account) throw new Error(`no account for ${email}`);

  if (command === 'show') {
    return {
      accountId: account.id,
      email: account.email,
      role: account.role,
      status: account.status,
      pilot: account.player?.name ?? null,
      createdAt: account.createdAt,
    };
  }

  const before = { role: account.role, status: account.status };
  const audit = (after: Prisma.InputJsonObject) =>
    prisma.adminAuditLog.create({
      data: { actor: CLI_ACTOR, action: `account.${command}`, target: account.id, before, after },
    });

  if (command === 'promote') {
    if (account.role === 'ADMIN')
      return { accountId: account.id, email, role: 'ADMIN', changed: false };
    await prisma.account.update({ where: { id: account.id }, data: { role: 'ADMIN' } });
    await audit({ role: 'ADMIN', status: account.status });
    return { accountId: account.id, email, role: 'ADMIN', changed: true };
  }

  if (command === 'demote') {
    if (account.role !== 'ADMIN')
      return { accountId: account.id, email, role: account.role, changed: false };
    const admins = await prisma.account.count({ where: { role: 'ADMIN' } });
    if (admins <= 1 && args.force !== true) {
      throw new Error(
        'this is the only admin: demoting it leaves nobody in charge (add --force to do it anyway)',
      );
    }
    await prisma.account.update({ where: { id: account.id }, data: { role: 'PLAYER' } });
    await audit({ role: 'PLAYER', status: account.status });
    return { accountId: account.id, email, role: 'PLAYER', changed: true };
  }

  if (command === 'ban') {
    if (account.role === 'ADMIN') throw new Error('an admin cannot be banned: demote it first');
    if (account.status === 'BANNED')
      return { accountId: account.id, email, status: 'BANNED', changed: false };
    await prisma.$transaction([
      prisma.account.update({ where: { id: account.id }, data: { status: 'BANNED' } }),
      // signed out everywhere: a ban has to take effect now, not when the access token runs out
      prisma.refreshToken.deleteMany({ where: { accountId: account.id } }),
    ]);
    await audit({ role: account.role, status: 'BANNED' });
    return { accountId: account.id, email, status: 'BANNED', changed: true };
  }

  if (command === 'unban') {
    if (account.status === 'ACTIVE')
      return { accountId: account.id, email, status: 'ACTIVE', changed: false };
    await prisma.account.update({ where: { id: account.id }, data: { status: 'ACTIVE' } });
    await audit({ role: account.role, status: 'ACTIVE' });
    return { accountId: account.id, email, status: 'ACTIVE', changed: true };
  }

  // set-password
  const password = args.password;
  if (!password || password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) {
    throw new Error(`--password must be ${PASSWORD_MIN_LENGTH}-${PASSWORD_MAX_LENGTH} characters`);
  }
  const passwordHash = await hash(password);
  await prisma.$transaction([
    prisma.account.update({ where: { id: account.id }, data: { passwordHash } }),
    // a fresh login with the new password everywhere it was signed in
    prisma.refreshToken.deleteMany({ where: { accountId: account.id } }),
  ]);
  // never log the password or its hash
  await audit({ role: account.role, status: account.status, passwordChanged: true });
  return { accountId: account.id, email, passwordChanged: true };
}
