import { useEffect, useState } from 'react';

/** The width at and below which the game switches to its phone layout (kept in step with styles/mobile.css). */
export const PHONE_MAX_WIDTH = 700;
const QUERY = `(max-width: ${PHONE_MAX_WIDTH}px)`;

const matches = (): boolean =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(QUERY).matches
    : false;

/** True on a phone-sized screen; follows a rotation or a resize. Always false where `matchMedia` does not exist (tests). */
export function useIsPhone(): boolean {
  const [phone, setPhone] = useState(matches);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const list = window.matchMedia(QUERY);
    const onChange = () => setPhone(list.matches);
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, []);
  return phone;
}
