export interface RegisterRequest {
  email: string;
  password: string;
  callsign: string;
}

export interface RegisterResponse {
  accessToken: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  accessToken: string;
}

export interface RefreshResponse {
  accessToken: string;
}

export type LogoutRequest = Record<string, never>;

export type UserRole = 'USER' | 'ADMIN';

export interface PlayerProfileResponse {
  id: string;
  email: string;
  role: UserRole;
  locale: string;
}

export interface UpdateLocaleRequest {
  locale: string;
}

export interface UpdateLocaleResponse {
  locale: string;
}

export interface AdminPlaceholderResponse {
  message: string;
}
