import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { client } from '../../api/client';
import type { DialogueEvent, DialogueState } from '../../api/generated';

export const DIALOGUE_KEY = ['dialogue'] as const;

/** How often the server is asked again whether a scene is due (a flight ended, a tank ran low). */
const REFRESH_MS = 20_000;

/** The scene due now, whether dialogues are on, and the scenes to hear again (the server decides, the web renders). */
export function useDialogueState(enabled: boolean) {
  return useQuery({
    queryKey: DIALOGUE_KEY,
    enabled,
    retry: false,
    staleTime: 5_000,
    refetchInterval: REFRESH_MS,
    queryFn: () => client.get<DialogueState>('/v1/players/me/dialogue'),
  });
}

export function useDialogueActions() {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: DIALOGUE_KEY });
  const record = useMutation({
    mutationFn: (input: { sceneId: string } & DialogueEvent) =>
      client.post<{ ok: true }>(`/v1/players/me/dialogue/${input.sceneId}`, {
        event: input.event,
        ...(input.nodeId === undefined ? {} : { nodeId: input.nodeId }),
      }),
  });
  const replay = useMutation({
    mutationFn: (sceneId: string) =>
      client.post<{ ok: true }>(`/v1/players/me/dialogue/${sceneId}/replay`, {}),
    onSuccess: refresh,
  });
  const setEnabled = useMutation({
    mutationFn: (enabled: boolean) =>
      client.post<{ ok: true }>('/v1/players/me/dialogue/settings', { enabled }),
    onSuccess: refresh,
  });
  return { record, replay, setEnabled, refresh };
}
