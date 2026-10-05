import { useQuery } from '@tanstack/react-query';
import { client } from '../../api/client';
import type { WorldResponse } from '../../api/generated';

/** The sector map (places and routes): static enough to share one cached read across screens. */
export function useWorld() {
  return useQuery({
    queryKey: ['world'],
    queryFn: () => client.get<WorldResponse>('/v1/locations'),
  });
}
