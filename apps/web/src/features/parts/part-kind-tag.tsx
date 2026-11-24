import { Fragment, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { PartCatalogStats } from '../../api/generated';
import { kindLabelOf, partKindOf } from './part-kind';
import { PartKindIcon } from './part-kind-icon';

type KindSource = Pick<PartCatalogStats, 'partClass' | 'partType'>;

/** The part's type (icon + label) for a meta line. An unknown family shows its class word. */
export function PartKindTag({ catalog }: { catalog: KindSource }): ReactNode {
  const { t } = useTranslation();
  const kind = partKindOf(catalog);
  const label = kindLabelOf(catalog, t);
  return (
    <span className="kind-tag">
      <PartKindIcon kind={kind} size={12} />
      {label}
    </span>
  );
}

/** Joins the pieces of a meta line with the usual middle dot, skipping empty ones. */
export function MetaLine({ pieces }: { pieces: ReadonlyArray<ReactNode> }): ReactNode {
  const shown = pieces.filter((piece) => piece !== null && piece !== false && piece !== '');
  return (
    <>
      {shown.map((piece, index) => (
        <Fragment key={index}>
          {index > 0 && ' · '}
          {piece}
        </Fragment>
      ))}
    </>
  );
}
