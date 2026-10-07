import { useTranslation } from 'react-i18next';

interface GridCellsPreviewProps {
  cells: unknown;
}

// Compact SVG thumbnail of a ship-format's cell set for the admin entity list — the raw
// `[number, number][]` dump (the "hash map" list view) is unreadable. Painted cells render
// as --spark rects, the mandatory anchor [0,0] as --bad, same visual language as the editor.
export function GridCellsPreview({ cells }: GridCellsPreviewProps) {
  const { t } = useTranslation();
  if (!Array.isArray(cells) || cells.length === 0) return null;
  const pairs = cells.filter(
    (cell): cell is [number, number] =>
      Array.isArray(cell) &&
      cell.length === 2 &&
      typeof cell[0] === 'number' &&
      typeof cell[1] === 'number',
  );
  if (pairs.length === 0) {
    return <span className="grid-preview-fallback">{JSON.stringify(cells)}</span>;
  }
  const xs = pairs.map(([x]) => x);
  const ys = pairs.map(([, y]) => y);
  const minX = Math.min(0, ...xs);
  const maxX = Math.max(0, ...xs);
  const minY = Math.min(0, ...ys);
  const maxY = Math.max(0, ...ys);
  const width = maxX - minX + 1;
  const height = maxY - minY + 1;
  return (
    <svg
      className="grid-cells-preview"
      viewBox={`${minX - 0.2} ${minY - 0.2} ${width + 0.4} ${height + 0.4}`}
      role="img"
      aria-label={t('tuning.gridCells.previewLabel', { count: pairs.length })}
    >
      {pairs.map(([x, y]) => (
        <rect
          key={`${x},${y}`}
          x={x}
          y={y}
          width={1}
          height={1}
          className={x === 0 && y === 0 ? 'grid-preview-anchor' : 'grid-preview-cell'}
        />
      ))}
    </svg>
  );
}
