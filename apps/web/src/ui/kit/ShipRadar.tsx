import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { PartKindIcon } from '../../features/parts/part-kind-icon';
import type { PartKind } from '../../features/parts/part-kind';
import type { ShipProfile } from '../../api/generated';

type Axis = keyof ShipProfile;

// Clockwise from the top.
export const RADAR_AXES: { key: Axis; kind: PartKind }[] = [
  { key: 'cargo', kind: 'cargo' },
  { key: 'passengers', kind: 'cabin' },
  { key: 'firepower', kind: 'weapon' },
  { key: 'defense', kind: 'shield' },
  { key: 'mobility', kind: 'engine' },
  { key: 'range', kind: 'tank' },
  { key: 'mining', kind: 'mining' },
];

const AXIS_COUNT = RADAR_AXES.length;
const VIEW = 200;
const CENTER = VIEW / 2;
const RADIUS = 58; // leaves room at the rim for the icon + label
const RINGS = [0.25, 0.5, 0.75, 1];
const LABELS_MIN_SIZE = 120;

function clamp01(v: number | undefined): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
}

function percent(v: number | undefined): string {
  return `${Math.round(clamp01(v) * 100)}%`;
}

function point(i: number, r: number): [number, number] {
  const a = (i / AXIS_COUNT) * Math.PI * 2 - Math.PI / 2;
  return [CENTER + Math.cos(a) * r, CENTER + Math.sin(a) * r];
}

function polygon(values: ShipProfile): string {
  return RADAR_AXES.map(({ key }, i) => {
    const [x, y] = point(i, clamp01(values[key]) * RADIUS);
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(' ');
}

export function ShipRadar({
  values,
  ghost,
  size = 200,
  label,
}: {
  values: ShipProfile;
  ghost?: ShipProfile;
  size?: number;
  label: string;
}): ReactNode {
  const { t } = useTranslation();
  const showLabels = size >= LABELS_MIN_SIZE;
  return (
    <span className="kit-radar" style={{ width: size, height: size }}>
      <svg
        viewBox={`0 0 ${VIEW} ${VIEW}`}
        width={size}
        height={size}
        role="img"
        aria-label={label}
        focusable="false"
      >
        {RINGS.map((f) => (
          <polygon
            key={f}
            className="kit-radar-ring"
            points={RADAR_AXES.map((_, i) => point(i, f * RADIUS).join(',')).join(' ')}
          />
        ))}
        {RADAR_AXES.map(({ key }, i) => {
          const [x, y] = point(i, RADIUS);
          return (
            <line key={key} className="kit-radar-spoke" x1={CENTER} y1={CENTER} x2={x} y2={y} />
          );
        })}
        {ghost && <polygon className="kit-radar-ghost" points={polygon(ghost)} />}
        <polygon className="kit-radar-shape" points={polygon(values)} />
        {RADAR_AXES.map(({ key, kind }, i) => {
          const [x, y] = point(i, RADIUS + (showLabels ? 20 : 16));
          const iconSize = showLabels ? 16 : 20;
          return (
            <g key={key} className="kit-radar-axis">
              <svg
                x={x - iconSize / 2}
                y={y - iconSize / 2 - (showLabels ? 6 : 0)}
                width={iconSize}
                height={iconSize}
                viewBox="0 0 20 20"
                aria-hidden="true"
              >
                <PartKindIcon kind={kind} size={20} />
              </svg>
              {showLabels && (
                <text className="kit-radar-label" x={x} y={y + 13} textAnchor="middle">
                  {t(`hangar.profile.axis.${key}`)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <table className="sr-only">
        <caption>{label}</caption>
        <tbody>
          {RADAR_AXES.map(({ key }) => (
            <tr key={key}>
              <th scope="row">{t(`hangar.profile.axis.${key}`)}</th>
              <td>{percent(values[key])}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </span>
  );
}
