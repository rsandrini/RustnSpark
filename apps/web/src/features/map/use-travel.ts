import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { client } from '../../api/client';
import type { DispatchResponse, TravelQuote } from '../../api/generated';

/** The server's price of flying to a place (route, time, fuel, blockers). Shared by the sheet, the details and the chart. */
export function useTravelQuote(placeId: string | null, enabled = true) {
  return useQuery({
    queryKey: ['travelQuote', placeId],
    enabled: enabled && placeId !== null,
    queryFn: () => client.get<TravelQuote>(`/v1/travel/quote?destinationId=${placeId}`),
  });
}

/** Starts a trip to a place without a mission; on success the pilot lands on the ship screen to watch it. */
export function useFlyTo(placeId: string) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: () => client.post<DispatchResponse>('/v1/travel', { destinationId: placeId }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['active'] });
      void queryClient.invalidateQueries({ queryKey: ['ships'] });
      void navigate('/ship');
    },
  });
}
