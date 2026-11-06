import { useEffect, useState } from 'react';

/** While `active`, where the pointer is on the screen (null until it has moved). */
export function useCarriedPointer(active: boolean): { x: number; y: number } | null {
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    if (!active) {
      setPoint(null);
      return undefined;
    }
    const onMove = (event: PointerEvent) => setPoint({ x: event.clientX, y: event.clientY });
    window.addEventListener('pointermove', onMove);
    return () => window.removeEventListener('pointermove', onMove);
  }, [active]);
  return point;
}
