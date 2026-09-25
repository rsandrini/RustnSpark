import { z } from 'zod';

/**
 * Parses a REAL API response with the shared contract schema (`packages/contract`) and fails
 * with a readable, path-by-path message if the server's answer does not match — the check that
 * keeps the web client's types honest. Returns the parsed (typed) value.
 */
export function contract<T>(schema: z.ZodType<T>, body: unknown, label: string): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new Error(
      `${label} does not match the contract:\n${z.prettifyError(result.error)}\n\nreceived: ${JSON.stringify(body).slice(0, 600)}`,
    );
  }
  return result.data;
}
