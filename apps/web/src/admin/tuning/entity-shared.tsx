/** The pre-filled form data for duplicating `row`: a fresh id (`<id>_copy`, to be edited) and
    "(copy)"-tagged names; everything else — stats, cells, rules, JSON blocks — is copied as is.
    Works for every entity: `idField` is the row's id column (`partType` for parts, else `id`). */
export function cloneOf(
  row: Record<string, unknown>,
  suffix: string,
  idField = 'id',
): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...row, [idField]: `${String(row[idField])}_copy` };
  const name = row.displayName;
  if (typeof name === 'object' && name !== null) {
    copy.displayName = Object.fromEntries(
      Object.entries(name as Record<string, string>).map(([locale, text]) => [locale, `${text} ${suffix}`]),
    );
  }
  return copy;
}
