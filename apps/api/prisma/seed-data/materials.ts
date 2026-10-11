import type { PrismaClient } from '@prisma/client';
import { PARTS } from './parts.js';

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
  // Upgrade pieces: found in dangerous places, never dug up. A core is crafted from fragments at a
  // port. They sell at a fixed price matching their recipe (a prototype core is worth five
  // fragments, an ancient core fifteen), so crafting breaks even and their value is what they unlock.
  {
    id: 'core_fragment',
    displayName: { en: 'Core Fragment', 'pt-BR': 'Fragmento de Núcleo' },
    description: {
      en: 'A shard of an old ship core. Several of them craft a whole core. Sells for a fixed price at any port.',
      'pt-BR':
        'Um estilhaço de um núcleo antigo de nave. Vários deles fabricam um núcleo inteiro. Vende por preço fixo em qualquer porto.',
    },
    rarity: 'EPIC' as const,
    basePrice: 60,
    fixedPrice: true,
  },
  {
    id: 'prototype_core',
    displayName: { en: 'Prototype Core', 'pt-BR': 'Núcleo Protótipo' },
    description: {
      en: 'An experimental core. Upgrading a rare part to epic needs it. Sells for a fixed price at any port.',
      'pt-BR':
        'Um núcleo experimental. Melhorar uma peça rara para épica exige um. Vende por preço fixo em qualquer porto.',
    },
    rarity: 'EPIC' as const,
    basePrice: 300,
    fixedPrice: true,
  },
  {
    id: 'ancient_core',
    displayName: { en: 'Ancient Core', 'pt-BR': 'Núcleo Ancestral' },
    description: {
      en: 'A core from before the sector was settled. Upgrading an epic part to legendary needs it. Sells for a fixed price at any port.',
      'pt-BR':
        'Um núcleo de antes do setor ser colonizado. Melhorar uma peça épica para lendária exige um. Vende por preço fixo em qualquer porto.',
    },
    rarity: 'LEGENDARY' as const,
    basePrice: 900,
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

// Scrap: one material per part type, worth the part's catalog scrap value at every port (fixed
// price). Scavenging in scrap places turns it up; it sells through the ordinary materials sale.
export async function seedScrapMaterials(prisma: PrismaClient): Promise<void> {
  const existing = new Set(
    (await prisma.material.findMany({ select: { id: true } })).map((m) => m.id),
  );
  const missing = PARTS
    // A bridge is never scavenged (and is worth nothing): only parts with a scrap value leave scrap.
    .filter((part) => part.partClass !== 'BRIDGE' && part.scrapValue > 0)
    .filter((part) => !existing.has(`scrap_${part.partType}`));
  if (missing.length === 0) return;
  await prisma.material.createMany({
    data: missing.map((part) => ({
      id: `scrap_${part.partType}`,
      displayName: {
        en: `Scrap: ${part.displayName.en}`,
        'pt-BR': `Sucata: ${part.displayName['pt-BR']}`,
      },
      description: {
        en: `Worn-out remains of a ${part.displayName.en}. Sells for a fixed price at any port.`,
        'pt-BR': `Restos gastos de ${part.displayName['pt-BR']}. Vende por preço fixo em qualquer porto.`,
      },
      rarity: part.rarity,
      basePrice: part.scrapValue,
      fixedPrice: true,
    })),
  });
}
