import { Injectable } from '@nestjs/common';
import { hash as argon2Hash, verify as argon2Verify } from '@node-rs/argon2';
import { EnvService } from '../common/env/env.module.js';

// @node-rs/argon2's `Algorithm` is an ambient `const enum`, which `isolatedModules` (required for
// ts-jest ESM, shared-context.md) cannot import: 2 is `Algorithm.Argon2id` per the package's .d.ts.
const ARGON2ID = 2;

// Argon2id hashing with env-configured cost (R18/R19): only @node-rs/argon2, never the npm
// `argon2` package (node-gyp build step) or a hand-rolled KDF.
@Injectable()
export class PasswordService {
  constructor(private readonly env: EnvService) {}

  async hash(plainPassword: string): Promise<string> {
    return argon2Hash(plainPassword, {
      algorithm: ARGON2ID,
      memoryCost: this.env.get('ARGON2_MEMORY_KIB'),
      timeCost: this.env.get('ARGON2_TIME_COST'),
      parallelism: this.env.get('ARGON2_PARALLELISM'),
    });
  }

  async verify(hashed: string, plainPassword: string): Promise<boolean> {
    return argon2Verify(hashed, plainPassword);
  }
}
