import type { Prisma } from '@prisma/client';

// Prisma's Json input type rejects readonly/interface-typed values even when they are plain
// JSON. One named cast here replaces the scattered `as unknown as never` at write sites; the
// caller owns the guarantee that the value really is JSON-serializable.
export function toJsonInput(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}
