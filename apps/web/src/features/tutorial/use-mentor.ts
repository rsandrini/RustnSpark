import { useQuery } from '@tanstack/react-query';
import { client } from '../../api/client';
import type { Mentor } from '../../api/generated';

/**
 * The pilot's faction mentor and what they say (plan §9): one cached query behind the Getting
 * started card and any screen that greets the pilot. Null before a faction is chosen or when the
 * faction has no mentor — the caller then keeps today's plain text.
 */
export function useMentor(enabled: boolean): Mentor | null {
  const query = useQuery({
    queryKey: ['mentor'],
    enabled,
    staleTime: 5 * 60 * 1000,
    retry: false,
    queryFn: () => client.get<Mentor | null>('/v1/players/me/mentor'),
  });
  return query.data ?? null;
}
