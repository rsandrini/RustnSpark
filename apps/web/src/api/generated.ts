export interface RegisterRequest {
  email: string;
  password: string;
  name: string;
}

export interface RegisterResponse {
  accessToken: string;
  player: PlayerProfileResponse;
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

export type UserRole = 'PLAYER' | 'ADMIN';

export interface PlayerProfileResponse {
  id: string;
  name: string;
  credits: number;
  locale: string;
  role: UserRole;
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

export interface ConfigEntryResponse {
  key: string;
  group: string;
  type: string;
  min: number;
  max: number;
  unit?: string;
  description: { en: string; 'pt-BR': string };
  currentValue: unknown;
  factoryDefault: unknown;
  modified: boolean;
}

export interface UpdateConfigValueRequest {
  value: unknown;
  expectedRevision: number;
  reason: string;
}

export interface ResetConfigValueRequest {
  expectedRevision: number;
  reason: string;
}

export interface TuningRevisionResponse {
  id: string;
  actor: string;
  entityType: string;
  entityId: string;
  before: unknown;
  after: unknown;
  reason: string;
  at: string;
}

export interface BundleExportEntry {
  key: string;
  value: unknown;
  factoryDefault: unknown;
  type: string;
}

export interface BundleExport {
  version: number;
  exportedAt: string;
  entries: BundleExportEntry[];
}

export interface BundleDiff {
  key: string;
  before: unknown;
  after: unknown;
}

export type EntityFieldType =
  | 'string'
  | 'integer'
  | 'float'
  | 'boolean'
  | 'json'
  | 'enum'
  | 'locale-map';

export interface EntitySchemaField {
  name: string;
  type: EntityFieldType;
  required: boolean;
  enumValues?: string[];
  min?: number;
  max?: number;
  description?: { en: string; 'pt-BR': string };
  configKey?: string;
}

export interface EntitySchemaResponse {
  entity: string;
  fields: EntitySchemaField[];
}

export interface CreateEntityRequest {
  data: Record<string, unknown>;
  reason: string;
}

export interface UpdateEntityRequest {
  data: Record<string, unknown>;
  reason: string;
}

export interface RetireEntityRequest {
  reason: string;
}

export interface EntityChangeResponse {
  row: Record<string, unknown>;
  revision: TuningRevisionResponse;
}
