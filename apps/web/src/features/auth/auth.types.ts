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
  /** The newcomer tutorial was skipped or finished; false while it should still show. */
  tutorialDone?: boolean;
  /** Started as a guest: the account menu offers to save the pilot with an email and password. */
  isGuest?: boolean;
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

/** Saving a guest pilot: an email and password, and optionally a pilot name instead of guest-xxxxxx. */
export interface ClaimData {
  email: string;
  password: string;
  name?: string;
}

export interface GuestStartResponse {
  accessToken: string;
  /** Shown once: the browser keeps it and signs the guest back in with it. */
  guestKey: string;
  player: UserProfile;
}
