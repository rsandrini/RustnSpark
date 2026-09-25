import type { UserRole } from '../../api/generated';

export type { UserRole };

export interface UserProfile {
  id: string;
  name: string;
  credits: number;
  locale: string;
  role: UserRole;
  /** null until onboarding picks a faction — gates the game routes (S10.2). */
  factionId: string | null;
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
