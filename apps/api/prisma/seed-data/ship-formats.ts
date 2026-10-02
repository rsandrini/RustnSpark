import type { PrismaClient } from '@prisma/client';

function classicSquareCells(): [number, number][] {
  const cells: [number, number][] = [];
  for (let y = -10; y < 10; y += 1) {
    for (let x = -10; x < 10; x += 1) {
      cells.push([x, y]);
    }
  }
  return cells;
}

export async function seedShipFormats(prisma: PrismaClient): Promise<void> {
  const existing = await prisma.shipFormat.findUnique({ where: { id: 'classic_square' } });
  if (existing !== null) return;
  await prisma.shipFormat.create({
    data: {
      id: 'classic_square',
      displayName: { en: 'Classic Square', 'pt-BR': 'Quadrado Clássico' },
      description: {
        en: 'The original 20x20 assembly grid, unlocked from the start.',
        'pt-BR': 'A grade de montagem 20x20 original, disponível desde o início.',
      },
      cells: classicSquareCells(),
      minRarity: 'COMMON',
      active: true,
    },
  });
}
