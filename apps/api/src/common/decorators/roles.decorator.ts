import { SetMetadata } from '@nestjs/common';
import type { AccountRole } from '../../auth/token.service.js';

// RolesGuard reads this via Reflector and checks it against request.user.role (CurrentUser's
// shape). Applied per-route, not globally (Step 11 admin-only endpoints).
export const ROLES_KEY = 'roles';

export const Roles = (...roles: AccountRole[]) => SetMetadata(ROLES_KEY, roles);
