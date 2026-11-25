import type { PartCatalogStats } from '../../api/generated';
import { partKindOf, type PartKind } from './part-kind';
import { PartKindIcon } from './part-kind-icon';

export interface PartArtProps {
  catalog: Pick<PartCatalogStats, 'partClass' | 'partType'>;
  rarity: string;
  /** 40 for a list row, 72 for a card. */
  size?: 40 | 72;
  /** Overrides the kind read off the catalog. */
  kind?: PartKind;
}

/**
 * The picture of a part until real art exists: a framed tile with the part's kind icon on a
 * rarity-tinted, subtly hatched background. Decorative (the name is always text beside it).
 * Slice 1.9's real art replaces this one component.
 */
export function PartArt({ catalog, rarity, size = 72, kind }: PartArtProps) {
  const shown = kind ?? partKindOf(catalog);
  return (
    <span
      className={`part-art part-art-${size} rarity-${rarity.toLowerCase()}`}
      data-testid="part-art"
      aria-hidden="true"
    >
      <PartKindIcon kind={shown} size={Math.round(size * 0.5)} />
    </span>
  );
}
