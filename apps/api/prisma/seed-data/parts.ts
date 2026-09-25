import type { PartClass, PrismaClient, Rarity } from '@prisma/client';

// Part stats reconciled from the simulators (D10). The simulator values win over
// design/catalogo-pecas-v0.1.md where they conflict.
type SeedPart = {
  partType: string;
  displayName: { en: string; 'pt-BR': string };
  description: { en: string; 'pt-BR': string };
  partClass: PartClass;
  rarity: Rarity;
  w: number;
  h: number;
  mass: number;
  structureCost: number;
  basePrice: number;
  scrapValue: number;
  partHp: number;
  pot?: number;
  pdf?: number;
  bli?: number;
  esc?: number;
  sen?: number;
  crg?: number;
  min?: number;
  energyCont?: number;
  energyCombat?: number;
  fuelCap?: number;
  fuelUse?: number;
  batCharge?: number;
  batOutput?: number;
  batInput?: number;
};

const PARTS: SeedPart[] = [
  {
    partType: 'bridge',
    displayName: { en: 'Bridge', 'pt-BR': 'Ponte de Comando' },
    description: {
      en: 'Compact command module; provides structure budget rather than consuming it.',
      'pt-BR': 'Módulo de comando compacto; fornece orçamento de estrutura em vez de consumi-lo.',
    },
    partClass: 'BRIDGE',
    rarity: 'COMMON',
    w: 1,
    h: 1,
    mass: 4,
    structureCost: -100,
    basePrice: 0,
    scrapValue: 0,
    partHp: 30,
    energyCont: -1,
  },
  {
    partType: 'engine_chem_small',
    displayName: { en: 'Small Chemical Engine', 'pt-BR': 'Motor Químico Pequeno' },
    description: {
      en: 'Light chemical thruster for small hulls.',
      'pt-BR': 'Propulsor químico leve para cascos pequenos.',
    },
    partClass: 'ENGINE',
    rarity: 'COMMON',
    w: 1,
    h: 1,
    mass: 3,
    structureCost: 6,
    basePrice: 100,
    scrapValue: 25,
    partHp: 20,
    pot: 25,
    energyCont: 2,
    fuelUse: 0.7,
  },
  {
    partType: 'engine_chem_medium',
    displayName: { en: 'Medium Chemical Engine', 'pt-BR': 'Motor Químico Médio' },
    description: {
      en: 'Balanced chemical engine for medium ships.',
      'pt-BR': 'Motor químico equilibrado para naves médias.',
    },
    partClass: 'ENGINE',
    rarity: 'COMMON',
    w: 1,
    h: 2,
    mass: 6,
    structureCost: 10,
    basePrice: 300,
    scrapValue: 75,
    partHp: 30,
    pot: 40,
    energyCont: 4,
    fuelUse: 1.2,
  },
  {
    partType: 'engine_chem_large',
    displayName: { en: 'Large Chemical Engine', 'pt-BR': 'Motor Químico Grande' },
    description: {
      en: 'Heavy chemical engine for large cargo or combat hulls.',
      'pt-BR': 'Motor químico pesado para cascos grandes de carga ou combate.',
    },
    partClass: 'ENGINE',
    rarity: 'UNCOMMON',
    w: 2,
    h: 2,
    mass: 14,
    structureCost: 20,
    basePrice: 800,
    scrapValue: 200,
    partHp: 45,
    pot: 70,
    energyCont: 7,
    fuelUse: 2.5,
  },
  {
    partType: 'engine_ion_micro',
    displayName: { en: 'Micro Ion Engine', 'pt-BR': 'Motor Iônico Micro' },
    description: {
      en: 'Tiny ionic drive with no fuel use; tournament-tested motor_pp.',
      'pt-BR':
        'Propulsor iônico minúsculo sem consumo de combustível; motor_pp validado no torneio.',
    },
    partClass: 'ENGINE',
    rarity: 'COMMON',
    w: 1,
    h: 1,
    mass: 2,
    structureCost: 5,
    basePrice: 150,
    scrapValue: 38,
    partHp: 15,
    pot: 18,
    energyCont: 0,
    fuelUse: 0,
  },
  {
    partType: 'tank_small',
    displayName: { en: 'Small Fuel Tank', 'pt-BR': 'Tanque de Combustível Pequeno' },
    description: {
      en: 'Small tank holding 1000 fuel units.',
      'pt-BR': 'Tanque pequeno com capacidade para 1000 unidades de combustível.',
    },
    partClass: 'TANK',
    rarity: 'COMMON',
    w: 1,
    h: 1,
    mass: 5,
    structureCost: 4,
    basePrice: 200,
    scrapValue: 50,
    partHp: 25,
    fuelCap: 1000,
  },
  {
    partType: 'battery_small',
    displayName: { en: 'Small Battery', 'pt-BR': 'Bateria Pequena' },
    description: {
      en: 'Compact power cell for small ships.',
      'pt-BR': 'Célula de energia compacta para naves pequenas.',
    },
    partClass: 'BATTERY',
    rarity: 'COMMON',
    w: 1,
    h: 1,
    mass: 5,
    structureCost: 6,
    basePrice: 150,
    scrapValue: 38,
    partHp: 20,
    batCharge: 300,
    batOutput: 80,
  },
  {
    partType: 'battery_large',
    displayName: { en: 'Large Battery', 'pt-BR': 'Bateria Grande' },
    description: {
      en: 'High-capacity battery bank for energy-hungry builds.',
      'pt-BR': 'Banco de baterias de alta capacidade para construções energéticas.',
    },
    partClass: 'BATTERY',
    rarity: 'UNCOMMON',
    w: 1,
    h: 2,
    mass: 14,
    structureCost: 14,
    basePrice: 400,
    scrapValue: 100,
    partHp: 35,
    batCharge: 900,
    batOutput: 200,
    batInput: 10,
  },
  {
    partType: 'weapon_ballistic',
    displayName: { en: 'Cannon', 'pt-BR': 'Canhão' },
    description: {
      en: 'Reliable ballistic cannon for close-range fire.',
      'pt-BR': 'Canhão balístico confiável para fogo de curto alcance.',
    },
    partClass: 'WEAPON',
    rarity: 'COMMON',
    w: 1,
    h: 1,
    mass: 3,
    structureCost: 5,
    basePrice: 120,
    scrapValue: 30,
    partHp: 20,
    pdf: 3,
  },
  {
    partType: 'weapon_laser',
    displayName: { en: 'Laser', 'pt-BR': 'Laser' },
    description: {
      en: 'Precision energy weapon that drains capacitors in combat.',
      'pt-BR': 'Arma de energia de precisão que drena capacitores em combate.',
    },
    partClass: 'WEAPON',
    rarity: 'UNCOMMON',
    w: 1,
    h: 1,
    mass: 4,
    structureCost: 7,
    basePrice: 350,
    scrapValue: 88,
    partHp: 22,
    pdf: 4,
    energyCombat: -5,
  },
  {
    partType: 'weapon_missile',
    displayName: { en: 'Heavy Missile', 'pt-BR': 'Míssil Pesado' },
    description: {
      en: 'Slow-firing missile launcher with high burst damage.',
      'pt-BR': 'Lançador de mísseis de disparo lento com alto dano em rajada.',
    },
    partClass: 'WEAPON',
    rarity: 'RARE',
    w: 1,
    h: 2,
    mass: 6,
    structureCost: 9,
    basePrice: 450,
    scrapValue: 113,
    partHp: 25,
    pdf: 8,
  },
  {
    partType: 'armor_plate',
    displayName: { en: 'Armor Plate', 'pt-BR': 'Placa de Armadura' },
    description: {
      en: 'Heavy plating that absorbs kinetic impacts.',
      'pt-BR': 'Blindagem pesada que absorve impactos cinéticos.',
    },
    partClass: 'DEFENSE',
    rarity: 'UNCOMMON',
    w: 2,
    h: 1,
    mass: 10,
    structureCost: 12,
    basePrice: 500,
    scrapValue: 125,
    partHp: 40,
    bli: 4,
  },
  {
    partType: 'hull',
    displayName: { en: 'Hull Frame', 'pt-BR': 'Estrutura de Casco' },
    description: {
      en: 'Basic structural frame with light armor.',
      'pt-BR': 'Estrutura básica com armadura leve.',
    },
    partClass: 'DEFENSE',
    rarity: 'COMMON',
    w: 2,
    h: 1,
    mass: 4,
    structureCost: 5,
    basePrice: 100,
    scrapValue: 25,
    partHp: 20,
    bli: 1,
  },
  {
    partType: 'shield_basic',
    displayName: { en: 'Basic Shield', 'pt-BR': 'Escudo Básico' },
    description: {
      en: 'Energy shield that regenerates between combat exchanges.',
      'pt-BR': 'Escudo de energia que se regenera entre trocas de combate.',
    },
    partClass: 'DEFENSE',
    rarity: 'UNCOMMON',
    w: 1,
    h: 1,
    mass: 4,
    structureCost: 7,
    basePrice: 400,
    scrapValue: 100,
    partHp: 25,
    esc: 14,
    energyCombat: -6,
  },
  {
    partType: 'sensor_radar',
    displayName: { en: 'Radar', 'pt-BR': 'Radar' },
    description: {
      en: 'Long-range sensor array for navigation and ambush avoidance.',
      'pt-BR': 'Array de sensores de longo alcance para navegação e evasão de emboscadas.',
    },
    partClass: 'SENSOR',
    rarity: 'COMMON',
    w: 1,
    h: 1,
    mass: 2,
    structureCost: 4,
    basePrice: 200,
    scrapValue: 50,
    partHp: 15,
    sen: 4,
    energyCont: -2,
  },
  {
    partType: 'cargo',
    displayName: { en: 'Cargo Hold', 'pt-BR': 'Compartimento de Carga' },
    description: {
      en: 'Pressurized cargo module for freight missions.',
      'pt-BR': 'Módulo de carga pressurizado para missões de frete.',
    },
    partClass: 'CARGO',
    rarity: 'COMMON',
    w: 1,
    h: 1,
    mass: 2,
    structureCost: 4,
    basePrice: 80,
    scrapValue: 20,
    partHp: 15,
    crg: 5,
  },
  {
    partType: 'mining_rig',
    displayName: { en: 'Mining Rig', 'pt-BR': 'Plataforma de Mineração' },
    description: {
      en: 'Automated extractor for asteroid and debris mining.',
      'pt-BR': 'Extrator automatizado para mineração de asteroides e detritos.',
    },
    partClass: 'UTILITY',
    rarity: 'UNCOMMON',
    w: 1,
    h: 2,
    mass: 8,
    structureCost: 10,
    basePrice: 400,
    scrapValue: 100,
    partHp: 25,
    min: 1,
    energyCont: -3,
  },
  {
    partType: 'reactor_solar',
    displayName: { en: 'Solar Panel', 'pt-BR': 'Painel Solar' },
    description: {
      en: 'Light photovoltaic array for continuous low output.',
      'pt-BR': 'Array fotovoltaico leve para saída contínua baixa.',
    },
    partClass: 'REACTOR',
    rarity: 'COMMON',
    w: 1,
    h: 1,
    mass: 2,
    structureCost: 3,
    basePrice: 300,
    scrapValue: 75,
    partHp: 15,
    energyCont: 30,
  },
  {
    partType: 'reactor_nuclear',
    displayName: { en: 'Nuclear Reactor', 'pt-BR': 'Reator Nuclear' },
    description: {
      en: 'Heavy fission reactor for high energy budgets.',
      'pt-BR': 'Reator de fissão pesado para orçamentos energéticos altos.',
    },
    partClass: 'REACTOR',
    rarity: 'RARE',
    w: 2,
    h: 2,
    mass: 14,
    structureCost: 18,
    basePrice: 2000,
    scrapValue: 500,
    partHp: 40,
    energyCont: 180,
  },
];

export async function seedParts(prisma: PrismaClient): Promise<void> {
  for (const part of PARTS) {
    const existing = await prisma.partCatalog.findUnique({ where: { partType: part.partType } });
    if (existing === null) {
      await prisma.partCatalog.create({ data: part });
    }
  }
}
