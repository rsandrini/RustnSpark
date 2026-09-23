import { client, refresh as refreshAccessToken } from '../../api/client';
import type * as dto from '../../api/generated';
import type { LoginCredentials, RegisterData } from './auth.types';

export const authApi = {
  async login(body: LoginCredentials): Promise<dto.LoginResponse> {
    return client.post<dto.LoginResponse>('/v1/auth/login', body);
  },

  async register(body: RegisterData): Promise<dto.RegisterResponse> {
    return client.post<dto.RegisterResponse>('/v1/auth/register', body);
  },

  async refresh(): Promise<dto.RefreshResponse> {
    const token = await refreshAccessToken();
    if (!token) {
      throw new Error('Unable to refresh session');
    }
    return { accessToken: token };
  },

  async logout(): Promise<void> {
    return client.post<void>('/v1/auth/logout');
  },

  async me(): Promise<dto.PlayerProfileResponse> {
    return client.get<dto.PlayerProfileResponse>('/v1/players/me');
  },

  async updateLocale(body: dto.UpdateLocaleRequest): Promise<dto.UpdateLocaleResponse> {
    return client.post<dto.UpdateLocaleResponse>('/v1/players/me/locale', body);
  },
};
