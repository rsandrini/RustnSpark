import { useQuery } from '@tanstack/react-query';
import { client } from '../api/client';
import type { ShipResponse } from '../api/generated';
import { useAuth } from '../features/auth/auth.hooks';
import { FactionBadge } from './FactionBadge';

// A ship always has a name (the server assigns a starter one), but a placeholder still guards
// against an unexpected blank — a short, stable hex tag derived from the ship's id, not a
// different random value on every render.
function hexPlaceholder(seed: string): string {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (Math.imul(hash, 31) + seed.charCodeAt(index)) >>> 0;
  }
  return (hash % 0xffffff).toString(16).padStart(6, '0').toUpperCase();
}

/**
 * Faction and ship name, in the middle of the top bar (owner request): who the pilot is
 * flying for, and which ship, visible from every in-game screen.
 */
export function ShipIdentity() {
  const { user } = useAuth();
  const shipsQuery = useQuery({
    queryKey: ['ships'],
    queryFn: () => client.get<ShipResponse[]>('/v1/ships'),
  });
  const ship = shipsQuery.data?.[0];
  if (user?.factionId == null) return null;

  const shipName =
    ship === undefined ? undefined : ship.name.trim() !== '' ? ship.name : hexPlaceholder(ship.id);

  return (
    <div className="ship-identity">
      <FactionBadge factionId={user.factionId} />
      {shipName !== undefined && <span className="ship-identity-name">{shipName}</span>}
    </div>
  );
}
