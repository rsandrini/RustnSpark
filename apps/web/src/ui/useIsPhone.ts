import { useEffect, useState } from 'react';

/** The width under which the game's four places move from the top bar to a bottom tab bar. */
export const PHONE_QUERY = '(max-width: 860px)';

/** True on a phone-width screen; false where `matchMedia` does not exist (tests, old browsers). */
export function useIsPhone(): boolean {
  const supported = typeof window !== 'undefined' && typeof window.matchMedia === 'function';
  const [phone, setPhone] = useState(() =>
    supported ? window.matchMedia(PHONE_QUERY).matches : false,
  );
  useEffect(() => {
    if (!supported) return undefined;
    const media = window.matchMedia(PHONE_QUERY);
    const onChange = () => setPhone(media.matches);
    onChange();
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [supported]);
  return phone;
}
