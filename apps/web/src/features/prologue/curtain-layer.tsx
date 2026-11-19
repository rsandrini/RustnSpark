import { useCurtain } from './curtain';

/** The black above the whole app while the opening hands over to the faction page (see curtain.ts). */
export function CurtainLayer() {
  const curtain = useCurtain();
  if (curtain === 'down') return null;
  return (
    <div
      className={`faction-curtain ${curtain}`}
      aria-hidden="true"
      data-testid="faction-curtain"
    />
  );
}
