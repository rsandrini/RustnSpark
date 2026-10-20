import type { PrismaClient } from '@prisma/client';

const MATERIALS = [
  {
    id: 'common_ore',
    displayName: { en: 'Common Ore', 'pt-BR': 'Minério Comum' },
    description: {
      en: 'Widely available raw ore traded in every port.',
      'pt-BR': 'Minério bruto amplamente disponível e comercializado em todos os portos.',
    },
    rarity: 'COMMON' as const,
    basePrice: 200,
  },
  {
    id: 'uncommon_minerals',
    displayName: { en: 'Uncommon Minerals', 'pt-BR': 'Minerais Incomuns' },
    description: {
      en: 'Refined minerals used in ship components and industry.',
      'pt-BR': 'Minerais refinados usados em componentes de naves e indústria.',
    },
    rarity: 'UNCOMMON' as const,
    basePrice: 600,
  },
  {
    id: 'rare_crystals',
    displayName: { en: 'Rare Crystals', 'pt-BR': 'Cristais Raros' },
    description: {
      en: 'Exotic crystals prized for high-end reactors and sensors.',
      'pt-BR': 'Cristais exóticos valorizados em reatores e sensores de ponta.',
    },
    rarity: 'RARE' as const,
    basePrice: 2000,
  },
  // Upgrade piece: found in dangerous places, never dug up. Epic and legendary upgrades ask for a
  // number of them directly (there are no cores to craft); it sells at a fixed price at any port.
  {
    id: 'core_fragment',
    displayName: { en: 'Core Fragment', 'pt-BR': 'Fragmento de Núcleo' },
    description: {
      en: 'A shard of an old ship core, found in dangerous places. Upgrading a part to epic or legendary asks for several of them. Sells for a fixed price at any port.',
      'pt-BR':
        'Um estilhaço de um núcleo antigo de nave, achado em lugares perigosos. Melhorar uma peça para épica ou lendária exige vários deles. Vende por preço fixo em qualquer porto.',
    },
    rarity: 'EPIC' as const,
    basePrice: 600,
    fixedPrice: true,
  },
];

export async function seedMaterials(prisma: PrismaClient): Promise<void> {
  for (const material of MATERIALS) {
    const existing = await prisma.material.findUnique({ where: { id: material.id } });
    if (existing === null) {
      await prisma.material.create({
        data: material,
      });
    }
  }
}

// Scrap: one generic, cheap, fixed-price material, whichever part it came from. Scavenging, repairs,
// discards and won fights hand it out; upgrades ask for it and any port buys it for its price.
export async function seedScrapMaterials(prisma: PrismaClient): Promise<void> {
  const existing = await prisma.material.findUnique({ where: { id: 'scrap' } });
  if (existing !== null) return;
  await prisma.material.create({
    data: {
      id: 'scrap',
      displayName: { en: 'Scrap', 'pt-BR': 'Sucata' },
      description: {
        en: 'Worn-out remains of ship parts. Upgrades ask for it, and any port buys it for a fixed price.',
        'pt-BR':
          'Restos gastos de peças de nave. Melhorias pedem sucata, e qualquer porto compra por um preço fixo.',
      },
      rarity: 'COMMON',
      basePrice: 100,
      fixedPrice: true,
    },
  });
}
