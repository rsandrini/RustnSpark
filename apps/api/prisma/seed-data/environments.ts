import type { PrismaClient } from '@prisma/client';

const ENVIRONMENTS = [
  {
    id: 'open',
    displayName: { en: 'Open Space', 'pt-BR': 'Espaço Aberto' },
    description: {
      en: 'Clear void with no environmental hazards.',
      'pt-BR': 'Vazio limpo sem perigos ambientais.',
    },
    level: 1,
    fuelMult: 1.0,
    subsystemTarget: 'none',
    mitigatingPart: 'none',
  },
  {
    id: 'radiation',
    displayName: { en: 'Radiation Field', 'pt-BR': 'Campo de Radiação' },
    description: {
      en: 'Ionizing radiation that stresses electronics.',
      'pt-BR': 'Radiação ionizante que sobrecarrega a eletrônica.',
    },
    level: 2,
    fuelMult: 1.0,
    subsystemTarget: 'electronics',
    mitigatingPart: 'hull',
  },
  {
    id: 'debris',
    displayName: { en: 'Debris Field', 'pt-BR': 'Campo de Detritos' },
    description: {
      en: 'Dense particle clouds and wreckage that batter the hull.',
      'pt-BR': 'Nuvens densas de partículas e destroços que castigam o casco.',
    },
    level: 3,
    fuelMult: 1.1,
    subsystemTarget: 'hull',
    mitigatingPart: 'armor_plate',
  },
  {
    id: 'gravitational',
    displayName: { en: 'Gravitational Anomaly', 'pt-BR': 'Anomalia Gravitacional' },
    description: {
      en: 'Strong tidal forces that strain engines and increase fuel burn.',
      'pt-BR': 'Fortes forças de maré que tensionam motores e aumentam o consumo de combustível.',
    },
    level: 2,
    fuelMult: 1.5,
    subsystemTarget: 'engine',
    mitigatingPart: 'engine_chem_medium',
  },
];

export async function seedEnvironments(prisma: PrismaClient): Promise<void> {
  for (const environment of ENVIRONMENTS) {
    const existing = await prisma.environment.findUnique({ where: { id: environment.id } });
    if (existing === null) {
      await prisma.environment.create({ data: environment });
    }
  }
}
