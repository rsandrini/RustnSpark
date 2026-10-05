import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { parseArgs } from 'node:util';
import { EnvModule } from '../../common/env/env.module.js';
import { PrismaModule } from '../../prisma/prisma.module.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { PasswordService } from '../../auth/password.service.js';

@Module({
  imports: [EnvModule, PrismaModule],
  providers: [PasswordService],
})
class SetPasswordCliModule {}

const MIN_LENGTH = 10;
const MAX_LENGTH = 128;

// There is no self-service or forgot-password flow yet (a real product gap — see the round-2
// plan): this is the only way to recover a locked-out account today. Local/owner use only; it
// never runs against a database it does not have direct access to.
async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      email: { type: 'string' },
      password: { type: 'string' },
    },
    allowPositionals: false,
  });
  if (!values.email) {
    throw new Error('--email is required');
  }
  if (
    !values.password ||
    values.password.length < MIN_LENGTH ||
    values.password.length > MAX_LENGTH
  ) {
    throw new Error(`--password must be ${MIN_LENGTH}-${MAX_LENGTH} characters`);
  }
  const email = values.email.toLowerCase();

  const app = await NestFactory.createApplicationContext(SetPasswordCliModule, {
    logger: false,
    abortOnError: false,
  });
  try {
    const prisma = app.get(PrismaService);
    const passwords = app.get(PasswordService);

    const account = await prisma.account.findUnique({ where: { email }, select: { id: true } });
    if (!account) {
      throw new Error(`no account for ${email}`);
    }

    const passwordHash = await passwords.hash(values.password);
    await prisma.account.update({ where: { id: account.id }, data: { passwordHash } });
    // Force a fresh login with the new password everywhere it was signed in.
    await prisma.refreshToken.deleteMany({ where: { accountId: account.id } });

    console.log(JSON.stringify({ accountId: account.id, email }));
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
