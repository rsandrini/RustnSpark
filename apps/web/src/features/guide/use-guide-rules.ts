import { useQuery } from '@tanstack/react-query';
import { client } from '../../api/client';
import type { GuideRulesResponse } from '../../api/generated';

/** The live figures the Guide quotes (admin-tunable); undefined until the server has answered. */
export function useGuideRules(): GuideRulesResponse | undefined {
  return useQuery({
    queryKey: ['guide', 'rules'],
    queryFn: () => client.get<GuideRulesResponse>('/v1/guide/rules'),
    staleTime: 5 * 60 * 1000,
    retry: false,
  }).data;
}
