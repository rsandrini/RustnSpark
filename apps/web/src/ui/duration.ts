/** "2m 30s" / "45s": a repair or trip time in the player's language (keys live under `duration`). */
export function formatDuration(
  seconds: number,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) return t('duration.hm', { h: hours, m: minutes });
  if (minutes > 0) return t('duration.ms', { m: minutes, s: secs });
  return t('duration.s', { s: secs });
}
