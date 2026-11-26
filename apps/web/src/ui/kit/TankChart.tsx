import type { CSSProperties } from 'react';

export interface TankChartTank {
  id: string;
  capacity: number;
}

export interface TankChartProps {
  tanks: readonly TankChartTank[];
  /** The ship's fuel: ONE pool shared by every tank. */
  fuel: number;
  /** The ship's total fuel capacity. */
  capacity: number;
  /** Where the fuel will stand after buying: shown as a dashed level when above `fuel`. */
  target?: number;
  /** Says the pool is shared (one fraction for every tank). */
  caption: string;
  /** The accessible summary of the whole chart. */
  label: string;
  format?: (value: number) => string;
}

const MAX_HEIGHT = 64;
const MIN_HEIGHT = 20;
const WIDTH = 28;

const fraction = (amount: number, capacity: number) =>
  capacity <= 0 ? 0 : Math.min(1, Math.max(0, amount / capacity));

// One vertical tank per installed tank part, tall in proportion to its capacity. The server keeps
// one shared fuel pool, so every glyph is filled to the SAME fraction of the ship's total.
export function TankChart({
  tanks,
  fuel,
  capacity,
  target,
  caption,
  label,
  format = (value) => String(Math.round(value)),
}: TankChartProps) {
  if (tanks.length === 0) return null;
  const largest = Math.max(...tanks.map((tank) => tank.capacity), 1);
  const level = fraction(fuel, capacity);
  const targetLevel = target !== undefined && target > fuel ? fraction(target, capacity) : null;
  return (
    <figure
      className="tank-chart"
      data-testid="tank-chart"
      role="img"
      aria-label={`${label}. ${caption}`}
    >
      <div className="tank-chart-row" aria-hidden="true">
        {tanks.map((tank) => {
          const height = Math.max(MIN_HEIGHT, (tank.capacity / largest) * MAX_HEIGHT);
          return (
            <div className="tank-chart-item" key={tank.id}>
              <svg
                className="tank-glyph"
                data-testid="tank-glyph"
                data-height={height}
                width={WIDTH}
                height={MAX_HEIGHT + 2}
                viewBox={`0 0 ${WIDTH} ${MAX_HEIGHT + 2}`}
              >
                <rect
                  className="tank-body"
                  x={1}
                  y={MAX_HEIGHT + 1 - height}
                  width={WIDTH - 2}
                  height={height}
                  rx={5}
                />
                <rect
                  className="tank-fill"
                  data-testid="tank-fill"
                  data-fraction={level}
                  style={{ '--level': level } as CSSProperties}
                  x={2}
                  y={MAX_HEIGHT + 2 - height}
                  width={WIDTH - 4}
                  height={height - 2}
                  rx={3}
                />
                {targetLevel !== null && (
                  <line
                    className="tank-target"
                    data-testid="tank-target"
                    x1={0}
                    x2={WIDTH}
                    y1={MAX_HEIGHT + 1 - height * targetLevel}
                    y2={MAX_HEIGHT + 1 - height * targetLevel}
                  />
                )}
              </svg>
              <small className="tank-cap">{format(tank.capacity)}</small>
            </div>
          );
        })}
      </div>
      <figcaption className="tank-chart-caption">
        <b data-testid="tank-total">{[format(fuel), format(capacity)].join(' / ')}</b>
        <span className="sub">{caption}</span>
      </figcaption>
    </figure>
  );
}
