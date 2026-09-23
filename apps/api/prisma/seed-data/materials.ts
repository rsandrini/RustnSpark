import type { PrismaClient } from '@prisma/client';
import { GAME_CONFIG_DEFAULTS } from '../../src/config/game-config.defaults.js';

const MATERIALS = [
  {
    id: 'common_ore',
    displayName: { en: 'Common Ore', 'pt-BR': 'Minério Comum' },
    description: {
      en: 'Widely available raw ore traded in every port.',
      'pt-BR': 'Minério bruto amplamente disponível e comercializado em todos os portos.',
    },
    rarity: 'COMMON' as const,
    basePrice: 20,
  },
  {
    id: 'uncommon_minerals',
    displayName: { en: 'Uncommon Minerals', 'pt-BR': 'Minerais Incomuns' },
    description: {
      en: 'Refined minerals used in ship components and industry.',
      'pt-BR': 'Minerais refinados usados em componentes de naves e indústria.',
    },
    rarity: 'UNCOMMON' as const,
    basePrice: 60,
  },
  {
    id: 'rare_crystals',
    displayName: { en: 'Rare Crystals', 'pt-BR': 'Cristais Raros' },
    description: {
      en: 'Exotic crystals prized for high-end reactors and sensors.',
      'pt-BR': 'Cristais exóticos valorizados em reatores e sensores de ponta.',
    },
    rarity: 'RARE' as const,
    basePrice: 200,
  },
];

export async function seedMaterials(prisma: PrismaClient): Promise<void> {
  const prices = GAME_CONFIG_DEFAULTS.mining.material_price as Record<string, number>;
  for (const material of MATERIALS) {
    const existing = await prisma.material.findUnique({ where: { id: material.id } });
    if (existing === null) {
      await prisma.material.create({
        data: {
          ...material,
          basePrice: prices[material.rarity.toLowerCase()] ?? material.basePrice,
        },
      });
    }
  }
}
