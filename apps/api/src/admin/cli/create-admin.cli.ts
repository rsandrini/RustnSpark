import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { validate } from 'class-validator';
import { AccountRole } from '@prisma/client';
import { parseArgs } from 'node:util';
import { EnvModule } from '../../common/env/env.module.js';
import { PrismaModule } from '../../prisma/prisma.module.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { PasswordService } from '../../auth/password.service.js';
import { RegisterDto } from '../../auth/dto/register.dto.js';

@Module({
  imports: [EnvModule, PrismaModule],
  providers: [PasswordService],
})
class AdminCliModule {}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      email: { type: 'string' },
      password: { type: 'string' },
      name: { type: 'string' },
    },
    allowPositionals: false,
  });

  const dto = Object.assign(new RegisterDto(), {
    email: values.email,
    password: values.password,
    name: values.name,
  });
  const validationErrors = await validate(dto);
  if (validationErrors.length > 0) {
    const messages = validationErrors.flatMap((error) =>
      Object.values(error.constraints ?? {}),
    );
    throw new Error(`validation failed:\n${messages.map((m) => `  - ${m}`).join('\n')}`);
  }

  const app = await NestFactory.createApplicationContext(AdminCliModule, {
    logger: false,
    abortOnError: false,
  });
  try {
    const prisma = app.get(PrismaService);
    const passwordService = app.get(PasswordService);
    const email = dto.email.toLowerCase();

    const existing = await prisma.account.findUnique({
      where: { email },
      select: { id: true },
    });
    if (existing) {
      throw new Error('an account with this email already exists');
    }

    const account = await prisma.account.create({
      data: {
        email,
        passwordHash: await passwordService.hash(dto.password),
        role: AccountRole.ADMIN,
        player: { create: { name: dto.name, credits: 0, locale: 'en' } },
      },
    });

    console.log(account.id);
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
