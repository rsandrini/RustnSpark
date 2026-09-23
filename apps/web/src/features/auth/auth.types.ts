import type { UserRole } from '../../api/generated';

export type { UserRole };

export interface UserProfile {
  id: string;
  email: string;
  role: UserRole;
  locale: string;
}

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface RegisterData {
  callsign: string;
  email: string;
  password: string;
}
