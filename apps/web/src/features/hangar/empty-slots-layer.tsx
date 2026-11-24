import type { KeyboardEvent, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { kindLabelKey } from '../parts/part-kind';
import { PartKindIcon } from '../parts/part-kind-icon';
import { kindOfNeed, type SlotHint } from './empty-slot-hints';

const ICON = 0.5;

/**
 * Dashed 1x1 slots on the yard where a needed part could go. The layer itself lets every pointer through
 * (a part dragged across keeps working); each slot takes its own clicks.
 */
export function EmptySlotsLayer({
  hints,
  onPick,
}: {
  hints: readonly SlotHint[];
  onPick: (needId: string) => void;
}): ReactNode {
  const { t } = useTranslation();
  if (hints.length === 0) return null;
  return (
    <g className="yard-slots" style={{ pointerEvents: 'none' }}>
      {hints.map((hint) => {
        const kind = kindOfNeed(hint.needId);
        const label = t('hangar.slotHint', { kind: t(kindLabelKey(kind)).toLowerCase() });
        const onKeyDown = (event: KeyboardEvent<SVGGElement>) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onPick(hint.needId);
          }
        };
        return (
          <g
            key={hint.needId}
            className="yard-slot"
            role="button"
            tabIndex={0}
            aria-label={label}
            style={{ pointerEvents: 'all', cursor: 'pointer' }}
            onClick={() => onPick(hint.needId)}
            onKeyDown={onKeyDown}
          >
            <rect
              className="yard-slot-box"
              x={hint.x + 0.06}
              y={hint.y + 0.06}
              width={0.88}
              height={0.88}
              rx={0.12}
            />
            <foreignObject
              x={hint.x + (1 - ICON) / 2}
              y={hint.y + (1 - ICON) / 2}
              width={ICON}
              height={ICON}
              style={{ pointerEvents: 'none' }}
            >
              <div className="yard-slot-icon">
                <PartKindIcon kind={kind} size={20} />
              </div>
            </foreignObject>
          </g>
        );
      })}
    </g>
  );
}
