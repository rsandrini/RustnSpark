import type { ReactNode } from 'react';

export interface SlotFrameProps {
  rarity?: 'common' | 'rare' | 'epic' | 'legendary';
  empty?: boolean;
  children?: ReactNode;
}

/** The square that holds a part: the frame colour is the rarity, a dashed frame is an empty slot. */
export function SlotFrame({ rarity = 'common', empty = false, children }: SlotFrameProps) {
  return (
    <span className={`kit-slot kit-slot--${rarity}${empty ? ' kit-slot--empty' : ''}`}>
      {children}
    </span>
  );
}
