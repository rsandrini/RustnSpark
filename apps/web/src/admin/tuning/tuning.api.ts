import { client } from '../../api/client';
import type * as dto from '../../api/generated';

export const tuningApi = {
  async listConfig(): Promise<dto.ConfigEntryResponse[]> {
    return client.get<dto.ConfigEntryResponse[]>('/v1/admin/tuning/config');
  },

  async updateConfig(
    key: string,
    body: dto.UpdateConfigValueRequest,
  ): Promise<dto.TuningRevisionResponse> {
    return client.patch<dto.TuningRevisionResponse>(
      `/v1/admin/tuning/config/${key}`,
      body,
    );
  },

  async resetConfig(
    key: string,
    body: dto.ResetConfigValueRequest,
  ): Promise<dto.TuningRevisionResponse> {
    return client.post<dto.TuningRevisionResponse>(
      `/v1/admin/tuning/config/${key}/reset`,
      body,
    );
  },

  async listRevisions(
    params: {
      entityType?: string;
      entityId?: string;
      limit?: number;
      offset?: number;
    } = {},
  ): Promise<dto.TuningRevisionResponse[]> {
    const search = new URLSearchParams();
    if (params.entityType) search.set('entityType', params.entityType);
    if (params.entityId) search.set('entityId', params.entityId);
    if (params.limit !== undefined) search.set('limit', String(params.limit));
    if (params.offset !== undefined) search.set('offset', String(params.offset));
    const query = search.toString();
    return client.get<dto.TuningRevisionResponse[]>(
      `/v1/admin/tuning/revisions${query ? `?${query}` : ''}`,
    );
  },

  async exportBundle(): Promise<dto.BundleExport> {
    return client.get<dto.BundleExport>('/v1/admin/tuning/bundle');
  },

  async dryRunBundle(
    entries: dto.BundleExportEntry[],
  ): Promise<{ valid: true; diffs: dto.BundleDiff[] }> {
    return client.post<{ valid: true; diffs: dto.BundleDiff[] }>(
      '/v1/admin/tuning/bundle?dryRun=true',
      { entries },
    );
  },

  async importBundle(
    entries: dto.BundleExportEntry[],
  ): Promise<{ revisions: dto.TuningRevisionResponse[] }> {
    return client.post<{ revisions: dto.TuningRevisionResponse[] }>(
      '/v1/admin/tuning/bundle',
      { entries },
    );
  },

  async getEntitySchema(entity: string): Promise<dto.EntitySchemaResponse> {
    return client.get<dto.EntitySchemaResponse>(
      `/v1/admin/tuning/schema/${entity}`,
    );
  },

  async listEntities<T = Record<string, unknown>>(entity: string): Promise<T[]> {
    return client.get<T[]>('/v1/admin/tuning/' + entity);
  },

  async getEntity(
    entity: string,
    id: string,
  ): Promise<Record<string, unknown>> {
    return client.get<Record<string, unknown>>(
      '/v1/admin/tuning/' + entity + '/' + id,
    );
  },

  async createEntity(
    entity: string,
    body: dto.CreateEntityRequest,
  ): Promise<dto.EntityChangeResponse> {
    return client.post<dto.EntityChangeResponse>('/v1/admin/tuning/' + entity, body);
  },

  async updateEntity(
    entity: string,
    id: string,
    body: dto.UpdateEntityRequest,
  ): Promise<dto.EntityChangeResponse> {
    return client.patch<dto.EntityChangeResponse>(
      '/v1/admin/tuning/' + entity + '/' + id,
      body,
    );
  },

  async retireEntity(
    entity: string,
    id: string,
    body: dto.RetireEntityRequest,
  ): Promise<dto.EntityChangeResponse> {
    return client.delete<dto.EntityChangeResponse>(
      '/v1/admin/tuning/' + entity + '/' + id,
      body,
    );
  },

  async revertRevision(
    id: string,
    reason: string,
  ): Promise<dto.TuningRevisionResponse> {
    return client.post<dto.TuningRevisionResponse>(
      `/v1/admin/tuning/revisions/${id}/revert`,
      { reason },
    );
  },
};
