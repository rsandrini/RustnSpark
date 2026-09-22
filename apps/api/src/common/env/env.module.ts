import { Global, Module } from '@nestjs/common';
import { type Env, validateEnv } from './env.schema.js';

export type { Env } from './env.schema.js';

export class EnvService {
  constructor(private readonly values: Env) {}

  get<K extends keyof Env>(key: K): Env[K] {
    return this.values[key];
  }
}

// Validation runs when the provider is created, so an invalid environment aborts bootstrap.
@Global()
@Module({
  providers: [{ provide: EnvService, useFactory: () => new EnvService(validateEnv(process.env)) }],
  exports: [EnvService],
})
export class EnvModule {}
