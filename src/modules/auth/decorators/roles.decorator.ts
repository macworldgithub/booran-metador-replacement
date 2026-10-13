import { SetMetadata } from '@nestjs/common';
import { UserRole } from '../../../common/enums';

export const ROLES_KEY = 'roles';
/** Restrict a route to specific roles. Supply one or more UserRole values. */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
