export interface PartThumbProps {
  name: string;
  rarity: string;
  className?: string;
}

/**
 * The picture of a part until real art exists: its first letter on a tile in the rarity colour.
 * Decorative (the name is always text beside it).
 */
export function PartThumb({ name, rarity, className }: PartThumbProps) {
  const letter = Array.from(name.trim())[0]?.toUpperCase() ?? '?';
  return (
    <span
      className={`part-thumb rarity-${rarity.toLowerCase()}${className === undefined ? '' : ` ${className}`}`}
      aria-hidden="true"
    >
      {letter}
    </span>
  );
}
