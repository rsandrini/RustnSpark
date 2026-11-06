import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { parseArgs } from 'node:util';
import { EnvModule } from '../../common/env/env.module.js';
import { PrismaModule } from '../../prisma/prisma.module.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { PasswordService } from '../../auth/password.service.js';
import { ACCOUNT_COMMANDS, runAccountCommand, type AccountCommand } from './account-commands.js';

@Module({
  imports: [EnvModule, PrismaModule],
  providers: [PasswordService],
})
class AccountCliModule {}

const USAGE = `usage: account <command> [--email <email> | --player <name>] [--password <password>] [--force]

commands:
  show --email E          role, status and pilot name of an account
  list-admins             every admin account
  promote --email E       make an existing account an admin
  demote --email E        make an admin a normal player (refuses the last admin without --force)
  ban --email E           block an account and sign it out everywhere (not for admins)
  unban --email E         let a banned account back in
  unfreeze --player NAME  let a frozen guest pilot back in (--email works too); counts as active again
  set-password --email E --password P   reset a password (10-128 characters) and sign out everywhere

Emergency tool for the server shell: every change is written to the admin audit log (actor "cli").`;

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    options: {
      email: { type: 'string' },
      player: { type: 'string' },
      password: { type: 'string' },
      force: { type: 'boolean' },
    },
    allowPositionals: true,
  });
  const command = positionals[0] as AccountCommand | undefined;
  if (command === undefined || !ACCOUNT_COMMANDS.includes(command)) {
    console.error(USAGE);
    process.exit(2);
  }

  const app = await NestFactory.createApplicationContext(AccountCliModule, {
    logger: false,
    abortOnError: false,
  });
  try {
    const passwords = app.get(PasswordService);
    const result = await runAccountCommand(
      app.get(PrismaService),
      (plain) => passwords.hash(plain),
      command,
      {
        email: values.email,
        player: values.player,
        password: values.password,
        force: values.force,
      },
    );
    console.log(JSON.stringify(result));
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
