import { factionColorVar, useFactions } from '../../ui/factions';

/** A round tile with the pilot's initial in a ring of the faction colour (no pilot portraits exist). */
export function PodiumAvatar({ name, factionId }: { name: string; factionId: string | null }) {
  const factions = useFactions();
  const color =
    factions.byId[factionId ?? '']?.color ??
    `var(${factionColorVar[factionId ?? ''] ?? '--neutro'})`;
  const initial = Array.from(name.trim())[0]?.toUpperCase() ?? '?';
  return (
    <span
      className="podium-avatar"
      aria-hidden="true"
      data-testid="podium-avatar"
      style={{ borderColor: color }}
    >
      {initial}
    </span>
  );
}
