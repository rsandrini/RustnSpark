const PERCENT = 100;

/** An engine level as a percentage of its listed power: 1.1 reads "110" (the template adds the % sign). */
export function enginePercent(level: number, language: string): string {
  return new Intl.NumberFormat(language, { maximumFractionDigits: 0 }).format(
    Math.round(level * PERCENT),
  );
}
