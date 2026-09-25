// Applies a config-key override ("parts.restart_condition_max", or deeper dotted paths)
// onto a rules copy so cross-key invariants can be checked against the *candidate*
// ruleset — what the world would look like after a single update or a whole bundle
// import — before anything is written.
export function withConfigOverride<T>(rules: T, key: string, value: unknown): T {
  return withConfigOverrides(rules, [{ key, value }]);
}

export function withConfigOverrides<T>(
  rules: T,
  entries: ReadonlyArray<{ key: string; value: unknown }>,
): T {
  const next = structuredClone(rules) as unknown as Record<string, unknown>;
  for (const { key, value } of entries) {
    const path = key.split('.');
    if (path.some((segment) => segment.length === 0)) continue;
    let cursor = next;
    for (const segment of path.slice(0, -1)) {
      const child = cursor[segment];
      if (typeof child !== 'object' || child === null || Array.isArray(child)) {
        cursor = {};
        break;
      }
      cursor = child as Record<string, unknown>;
    }
    cursor[path[path.length - 1]!] = value;
  }
  return next as unknown as T;
}
