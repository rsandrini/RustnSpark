import { SetMetadata } from '@nestjs/common';

// JwtAuthGuard reads this via Reflector: a route/controller marked @Public() skips JWT
// verification entirely. GET /v1/health carries it so Docker healthchecks and CI keep working
// once the global guard lands (S2.4).
export const IS_PUBLIC_KEY = 'isPublic';

export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
