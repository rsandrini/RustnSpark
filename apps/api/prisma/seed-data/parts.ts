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
      en: 'The command core of your ship. Every ship needs exactly one. It keeps the pilot alive if the rest of the ship is lost, and it sets how much structure (total build weight) the ship can carry.',
      'pt-BR':
        'O núcleo de comando da sua nave. Toda nave precisa de exatamente uma. Ela mantém o piloto vivo se o resto da nave for perdido e define quanta estrutura (peso total de construção) a nave aguenta.',
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
      en: 'A light rocket engine that moves the ship. It burns fuel, so you also need a fuel tank. Cheap and thrifty, but too weak to push a heavy ship fast.',
      'pt-BR':
        'Um motor a foguete leve que move a nave. Ele queima combustível, então você também precisa de um tanque. Barato e econômico, mas fraco demais para mover uma nave pesada rápido.',
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
      en: 'The all-round engine: clearly more thrust than the small one, for more fuel use and mass. A good fit for ships that carry cargo or armor. Needs a fuel tank.',
      'pt-BR':
        'O motor versátil: bem mais empuxo que o pequeno, com mais consumo e massa. Serve bem para naves com carga ou blindagem. Precisa de um tanque de combustível.',
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
      en: 'Big thrust for big ships. Moves heavy cargo or warship builds at a decent speed, but it is heavy, takes a 2×2 block and burns fuel fast. Needs a fuel tank.',
      'pt-BR':
        'Muito empuxo para naves grandes. Move construções pesadas de carga ou guerra numa velocidade decente, mas é pesado, ocupa um bloco 2×2 e queima combustível rápido. Precisa de um tanque de combustível.',
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
      en: 'A tiny electric drive that burns no fuel, so no tank is needed. Its thrust is low: good for light ships and long trips where refuelling is a hassle. Needs steady power from a reactor or solar panel.',
      'pt-BR':
        'Um pequeno motor elétrico que não queima combustível, então não precisa de tanque. O empuxo é baixo: bom para naves leves e viagens longas em que reabastecer é um problema. Precisa de energia constante de um reator ou painel solar.',
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
      en: 'Holds your fuel. Every chemical engine burns fuel, so a ship with one needs at least one tank; more tanks mean more range between refuels. Adds mass and uses structure.',
      'pt-BR':
        'Guarda o seu combustível. Todo motor químico queima combustível, então uma nave com um precisa de pelo menos um tanque; mais tanques significam mais alcance entre reabastecimentos. Adiciona massa e usa estrutura.',
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
      en: 'Stores energy for combat. Shields and lasers draw from it during a fight, and if it cannot cover their demand the ship is not allowed to fly. Small and cheap.',
      'pt-BR':
        'Guarda energia para o combate. Escudos e lasers consomem dela durante a luta, e se ela não cobre a demanda a nave não pode voar. Pequena e barata.',
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
      en: 'A large energy store for power-hungry builds (lasers plus a shield). Far more charge and output than the small battery, but heavy and a 1×2 block.',
      'pt-BR':
        'Um grande estoque de energia para construções famintas por energia (lasers mais escudo). Muito mais carga e saída que a bateria pequena, mas pesada e ocupa um bloco 1×2.',
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
      en: 'A basic cannon. Cheap, reliable damage that needs no energy: a good first weapon for escort missions. Modest firepower.',
      'pt-BR':
        'Um canhão básico. Dano barato e confiável que não usa energia: uma boa primeira arma para missões de escolta. Poder de fogo modesto.',
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
      en: 'A precise energy weapon with more firepower than the cannon. It draws combat energy from your batteries every round, so pair it with a battery.',
      'pt-BR':
        'Uma arma de energia precisa, com mais poder de fogo que o canhão. Consome energia de combate das baterias a cada rodada, então use com uma bateria.',
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
      en: 'Heavy missiles: the highest firepower of any weapon, paid for in size (1×2), mass and price. Rare. Take it when you expect to fight.',
      'pt-BR':
        'Mísseis pesados: o maior poder de fogo entre as armas, pago em tamanho (1×2), massa e preço. Rara. Leve quando espera lutar.',
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
      en: 'Heavy armor plating: the most protection per part, cutting the damage from every hit. Very heavy, so it slows your ship down.',
      'pt-BR':
        'Placa de blindagem pesada: a maior proteção por peça, reduzindo o dano de cada ataque. Muito pesada, então deixa a nave mais lenta.',
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
      en: 'A cheap, light structural frame with a little armor. Adds hit points and a touch of protection, but no speed, cargo or firepower.',
      'pt-BR':
        'Uma estrutura barata e leve com um pouco de blindagem. Adiciona pontos de casco e um toque de proteção, mas nenhuma velocidade, carga ou poder de fogo.',
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
      en: 'An energy shield: absorbs damage first and recharges between rounds of a fight. Draws combat energy, so it needs a battery. Great against pirates; useless if the battery cannot power it.',
      'pt-BR':
        'Um escudo de energia: absorve o dano primeiro e recarrega entre as rodadas da luta. Consome energia de combate, então precisa de bateria. Ótimo contra piratas; inútil se a bateria não conseguir alimentá-lo.',
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
      en: 'Long-range sensors that spot ambushes before they happen, lowering the chance of being caught by pirates. Draws a little power all the time.',
      'pt-BR':
        'Sensores de longo alcance que detectam emboscadas antes que aconteçam, reduzindo a chance de ser pego por piratas. Consome um pouco de energia o tempo todo.',
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
      en: 'Cargo space. Each hold adds capacity for deliveries, so more holds mean bigger, better-paid jobs. Adds mass, which slows the ship.',
      'pt-BR':
        'Espaço de carga. Cada compartimento aumenta a capacidade para entregas, então mais compartimentos significam trabalhos maiores e mais bem pagos. Adiciona massa, o que deixa a nave mais lenta.',
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
      en: 'An automated extractor. Needed for mining missions and for pulling ore out of asteroid fields, which you sell at ports. Draws steady power and adds mass.',
      'pt-BR':
        'Um extrator automático. Necessária para missões de mineração e para tirar minério de campos de asteroides, que você vende nos portos. Consome energia constante e adiciona massa.',
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
      en: 'A light solar array with a small but constant power output. Covers what engines, radar and rigs draw in flight at almost no weight.',
      'pt-BR':
        'Um painel solar leve com produção de energia pequena, mas constante. Cobre o que motores, radar e mineradoras consomem em voo, com quase nenhum peso.',
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
      en: 'A heavy fission reactor with a very large power output, for builds full of power-hungry parts. Rare, expensive and heavy (2×2).',
      'pt-BR':
        'Um reator de fissão pesado com produção de energia muito alta, para construções cheias de peças que consomem muita energia. Raro, caro e pesado (2×2).',
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
