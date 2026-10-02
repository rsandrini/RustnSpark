const CANVAS_HALF_SIZE = 15;

export interface GridCellsEditorProps {
  value: [number, number][] | undefined;
  onChange: (cells: [number, number][]) => void;
}

// A small paint grid for authoring a Ship Format's cell set (2026-10-02-ship-format-design.md):
// click a cell to toggle it in/out. The bridge's anchor cell (0,0) is always painted and cannot
// be erased — every format is drawn "from" the bridge outward.
export function GridCellsEditor({ value, onChange }: GridCellsEditorProps) {
  const cells = value ?? [[0, 0]];
  const painted = new Set(cells.map(([x, y]) => `${x},${y}`));

  const toggle = (x: number, y: number) => {
    if (x === 0 && y === 0) return;
    const key = `${x},${y}`;
    const next = painted.has(key)
      ? cells.filter(([cx, cy]) => !(cx === x && cy === y))
      : [...cells, [x, y] as [number, number]];
    onChange(next);
  };

  const coords: number[] = [];
  for (let i = -CANVAS_HALF_SIZE; i <= CANVAS_HALF_SIZE; i += 1) coords.push(i);

  return (
    <div className="grid-cells-editor" role="group" aria-label="Format cells">
      {coords.map((y) => (
        <div key={y} className="grid-cells-row">
          {coords.map((x) => {
            const isAnchor = x === 0 && y === 0;
            const isPainted = painted.has(`${x},${y}`);
            return (
              <button
                key={x}
                type="button"
                data-testid={`grid-cell-${x}-${y}`}
                className={`grid-cells-cell${isPainted ? ' painted' : ''}${isAnchor ? ' anchor' : ''}`}
                aria-pressed={isPainted}
                disabled={isAnchor}
                onClick={() => toggle(x, y)}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}
