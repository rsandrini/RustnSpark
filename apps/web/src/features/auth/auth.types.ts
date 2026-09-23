import type { UserRole } from '../../api/generated';

export type { UserRole };

export interface UserProfile {
  id: string;
  name: string;
  credits: number;
  locale: string;
  role: UserRole;
}

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface RegisterData {
  name: string;
  email: string;
  password: string;
}
