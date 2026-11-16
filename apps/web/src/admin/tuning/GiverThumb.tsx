import { useQuery } from '@tanstack/react-query';
import { client } from '../../api/client';

/** The uploaded portraits of every guide, by guide id (the same data the art editor reads). */
export function useGiverPortraits(): Record<string, string | null> {
  const query = useQuery({
    queryKey: ['giverArt'],
    queryFn: () =>
      client.get<{ givers: Record<string, Record<string, string | null>> }>('/v1/givers/art'),
  });
  const out: Record<string, string | null> = {};
  for (const [id, art] of Object.entries(query.data?.givers ?? {})) out[id] = art.portrait ?? null;
  return out;
}

/** A guide's small portrait for a list row; a blank round slot while it has none. */
export function GiverThumb({ url, name }: { url: string | null | undefined; name: string }) {
  return url == null ? (
    <span className="giver-thumb giver-thumb-empty" aria-hidden="true" />
  ) : (
    <img className="giver-thumb" src={url} alt={name} loading="lazy" />
  );
}
