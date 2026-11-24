import { useQuery } from '@tanstack/react-query';
import { client } from '../api/client';
import type { FactionsResponse, PublicFaction } from '../api/generated';
import { pickLocalized } from '../i18n/localized';

export interface FactionsData {
  readonly list: readonly PublicFaction[];
  readonly byId: Readonly<Record<string, PublicFaction>>;
}

/**
 * The factions as the admin has them: names, pitch, colour and uploaded images all come from the
 * database, never from the language files (those are only a fallback while this loads or for a
 * faction the server does not know). One cached query shared by every screen.
 */
export function useFactions(): FactionsData {
  const query = useQuery({
    queryKey: ['factions'],
    queryFn: () => client.get<FactionsResponse>('/v1/factions'),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  const list = query.data?.factions ?? [];
  return { list, byId: Object.fromEntries(list.map((faction) => [faction.id, faction])) };
}

/** The faction's name in the player's language, or undefined when the server has no such faction. */
export function factionName(faction: PublicFaction | undefined, language: string): string | undefined {
  if (faction === undefined) return undefined;
  const name = pickLocalized(faction.displayName, language);
  return name === '' ? undefined : name;
}

export function factionBlurb(faction: PublicFaction | undefined, language: string): string | undefined {
  if (faction === undefined) return undefined;
  const blurb = pickLocalized(faction.description, language);
  return blurb === '' ? undefined : blurb;
}
