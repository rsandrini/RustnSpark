type ConnectorKind = 'none' | 'central' | 'split' | 'universal';
type ConnectorSide = 'N' | 'E' | 'S' | 'W';
interface ConnectorCell {
  dx: number;
  dy: number;
  side: ConnectorSide;
  kind: ConnectorKind;
}
export interface ConnectorLayout {
  cells: ConnectorCell[];
}

const CYCLE: ConnectorKind[] = ['none', 'central', 'split', 'universal'];
const SIDES: ConnectorSide[] = ['N', 'E', 'S', 'W'];
const ADD_CANDIDATE_LABEL = 'Add candidate';

export interface ConnectorLayoutEditorProps {
  value: ConnectorLayout[] | undefined;
  w: number;
  h: number;
  onChange: (layouts: ConnectorLayout[]) => void;
}

function kindAt(layout: ConnectorLayout, dx: number, dy: number, side: ConnectorSide): ConnectorKind {
  return layout.cells.find((c) => c.dx === dx && c.dy === dy && c.side === side)?.kind ?? 'none';
}

function setKind(
  layout: ConnectorLayout,
  dx: number,
  dy: number,
  side: ConnectorSide,
  kind: ConnectorKind,
): ConnectorLayout {
  const rest = layout.cells.filter((c) => !(c.dx === dx && c.dy === dy && c.side === side));
  return kind === 'none' ? { cells: rest } : { cells: [...rest, { dx, dy, side, kind }] };
}

// One small grid per candidate layout, click a cell's side to cycle its connector kind
// (2026-10-02-connectors-v1-design.md). Each candidate is a complete layout the random roll
// at instance-creation time can pick from whole.
export function ConnectorLayoutEditor({ value, w, h, onChange }: ConnectorLayoutEditorProps) {
  const layouts = value ?? [{ cells: [] }];

  const cycleSide = (candidateIndex: number, dx: number, dy: number, side: ConnectorSide) => {
    const layout = layouts[candidateIndex]!;
    const current = kindAt(layout, dx, dy, side);
    const next = CYCLE[(CYCLE.indexOf(current) + 1) % CYCLE.length]!;
    const updated = [...layouts];
    updated[candidateIndex] = setKind(layout, dx, dy, side, next);
    onChange(updated);
  };

  return (
    <div className="connector-layout-editor">
      {layouts.map((layout, candidateIndex) => (
        <div key={candidateIndex} className="connector-candidate">
          {Array.from({ length: h }, (_, dy) => (
            <div key={dy} className="connector-cell-row">
              {Array.from({ length: w }, (_, dx) => (
                <div key={dx} className="connector-cell">
                  {SIDES.map((side) => (
                    <button
                      key={side}
                      type="button"
                      data-testid={`connector-side-${dx}-${dy}-${side}-candidate-${candidateIndex}`}
                      className={`connector-side connector-side-${side} connector-kind-${kindAt(layout, dx, dy, side)}`}
                      onClick={() => cycleSide(candidateIndex, dx, dy, side)}
                    >
                      {kindAt(layout, dx, dy, side) !== 'none' ? kindAt(layout, dx, dy, side)[0] : ''}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          ))}
        </div>
      ))}
      <button type="button" onClick={() => onChange([...layouts, { cells: [] }])}>
        {ADD_CANDIDATE_LABEL}
      </button>
    </div>
  );
}
