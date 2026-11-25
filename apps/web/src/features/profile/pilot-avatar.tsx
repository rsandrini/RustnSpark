import { factionColorVar, useFactions } from '../../ui/factions';

export interface PilotAvatarProps {
  name: string;
  factionId: string | null;
  size?: number;
}

/** A round tile with the pilot's initial, ringed in the faction colour (neutral when the faction is unknown). */
export function PilotAvatar({ name, factionId, size = 56 }: PilotAvatarProps) {
  const faction = useFactions().byId[factionId ?? ''];
  const initial = Array.from(name.trim())[0]?.toUpperCase() ?? '?';
  return (
    <span
      className="pilot-avatar"
      aria-hidden="true"
      data-testid="pilot-avatar"
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.45),
        borderColor: faction?.color ?? `var(${factionColorVar[factionId ?? ''] ?? '--neutro'})`,
      }}
    >
      {initial}
    </span>
  );
}
