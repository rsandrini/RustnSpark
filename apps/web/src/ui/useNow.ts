import { useEffect, useState } from 'react';
import { serverNow } from '../api/client';

/** The server clock in ms, re-read every `intervalMs` while `active` (animations, live positions). */
export function useNow(active: boolean, intervalMs = 1000): number {
  const [now, setNow] = useState(() => serverNow());
  useEffect(() => {
    if (!active) return undefined;
    setNow(serverNow());
    const timer = setInterval(() => setNow(serverNow()), intervalMs);
    return () => clearInterval(timer);
  }, [active, intervalMs]);
  return now;
}
