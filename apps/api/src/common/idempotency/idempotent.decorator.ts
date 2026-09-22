import { SetMetadata, type CustomDecorator } from '@nestjs/common';

// Marks a route as idempotency-guarded: the global IdempotencyInterceptor (S2.5, R21) then
// requires an Idempotency-Key header and serializes same-key execution/replay. Metadata only —
// the interceptor does the work, so undecorated routes are completely untouched.
export const IDEMPOTENT_KEY = 'idempotency:idempotent';

export const Idempotent = (): CustomDecorator => SetMetadata(IDEMPOTENT_KEY, true);
