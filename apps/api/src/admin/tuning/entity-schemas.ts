import { z } from 'zod';

export type EntityFieldType =
  | 'string'
  | 'integer'
  | 'float'
  | 'boolean'
  | 'json'
  | 'enum'
  | 'locale-map'
  | 'grid-cells'
  | 'connector-layout';

export interface EntitySchemaField {
  name: string;
  type: EntityFieldType;
  required: boolean;
  enumValues?: string[];
  min?: number;
  max?: number;
  description?: { en: string; 'pt-BR': string };
  configKey?: string;
}

export interface EntitySchema {
  entity: string;
  model: string;
  fields: EntitySchemaField[];
}

const localeMapSchema = z.object({
  en: z.string().min(1),
  'pt-BR': z.string().min(1),
});

// Ship Format's admin drawing-canvas ceiling (2026-10-02-ship-format-design.md) — enforced
// server-side here, not only by the web widget.
const GRID_CELLS_CEILING = 15;

const gridCellsSchema = z
  .array(z.tuple([z.number().int(), z.number().int()]))
  .refine((cells) => cells.some(([x, y]) => x === 0 && y === 0), {
    message: 'cells must include the bridge anchor [0, 0]',
  })
  .refine(
    (cells) =>
      cells.every(([x, y]) => Math.abs(x) <= GRID_CELLS_CEILING && Math.abs(y) <= GRID_CELLS_CEILING),
    { message: 'cells must stay within the +/-15 drawing ceiling' },
  );

// Connectors v0.1 (2026-10-02-connectors-v1-design.md): shape-only validation here (dx/dy
// integers, side/kind enums) — the cross-field "cells stay within this part's own w x h"
// check needs the sibling w/h fields on the same payload, which a single-field validator
// can't see, so that lives in entity-tuning.service.ts's validateEntityRules hook instead.
const connectorLayoutSchema = z.array(
  z.object({
    cells: z.array(
      z.object({
        dx: z.number().int(),
        dy: z.number().int(),
        side: z.enum(['N', 'E', 'S', 'W']),
        kind: z.enum(['none', 'central', 'split', 'universal']),
      }),
    ),
  }),
);

function buildBaseValidator(field: EntitySchemaField): z.ZodType<unknown> {
  switch (field.type) {
    case 'string':
      return z.string();
    case 'integer':
      return z.number().int();
    case 'float':
      return z.number();
    case 'boolean':
      return z.boolean();
    case 'json':
      return z.record(z.string(), z.unknown());
    case 'enum':
      return z.enum(field.enumValues as [string, ...string[]]);
    case 'locale-map':
      return localeMapSchema;
    case 'grid-cells':
      return gridCellsSchema;
    case 'connector-layout':
      return connectorLayoutSchema;
    default:
      return z.never();
  }
}

function applyBounds(validator: z.ZodType<unknown>, field: EntitySchemaField): z.ZodType<unknown> {
  if (field.type !== 'integer' && field.type !== 'float') return validator;
  let numeric = validator as z.ZodNumber;
  if (field.min !== undefined) numeric = numeric.min(field.min);
  if (field.max !== undefined) numeric = numeric.max(field.max);
  return numeric;
}

export function buildEntityValidator(
  schema: EntitySchema,
  mode: 'create' | 'update',
): z.ZodType<Record<string, unknown>> {
  const shape: Record<string, z.ZodType<unknown>> = {};
  for (const field of schema.fields) {
    let validator = applyBounds(buildBaseValidator(field), field);
    if (mode === 'update' || !field.required) {
      validator = validator.optional();
    }
    shape[field.name] = validator;
  }
  return z.object(shape).strict();
}

function localeMap(en: string, ptBR: string): { en: string; 'pt-BR': string } {
  return { en, 'pt-BR': ptBR };
}

const RARITY_VALUES = ['COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY'];
const PART_CLASS_VALUES = [
  'ENGINE',
  'TANK',
  'BATTERY',
  'REACTOR',
  'WEAPON',
  'DEFENSE',
  'CARGO',
  'SENSOR',
  'UTILITY',
  'BRIDGE',
];
const MISSION_TYPE_VALUES = [
  'DELIVERY',
  'TRANSPORT',
  'ESCORT',
  'MINING',
  'RESCUE',
  'TRAVEL',
  'SCAVENGE',
];

const PART_FIELDS: EntitySchemaField[] = [
  {
    name: 'partType',
    type: 'string',
    required: true,
    description: localeMap('Unique part type code', 'Código único da peça'),
  },
  {
    name: 'displayName',
    type: 'locale-map',
    required: true,
    description: localeMap('Display name by locale', 'Nome de exibição por idioma'),
  },
  {
    name: 'description',
    type: 'locale-map',
    required: true,
    description: localeMap('Description by locale', 'Descrição por idioma'),
  },
  {
    name: 'partClass',
    type: 'enum',
    required: true,
    enumValues: PART_CLASS_VALUES,
    description: localeMap('Part class', 'Classe da peça'),
  },
  {
    name: 'rarity',
    type: 'enum',
    required: true,
    enumValues: RARITY_VALUES,
    description: localeMap('Rarity tier', 'Raridade'),
  },
  {
    name: 'w',
    type: 'integer',
    required: true,
    min: 1,
    max: 10,
    description: localeMap('Grid width', 'Largura da grade'),
  },
  {
    name: 'h',
    type: 'integer',
    required: true,
    min: 1,
    max: 10,
    description: localeMap('Grid height', 'Altura da grade'),
  },
  {
    name: 'mass',
    type: 'float',
    required: true,
    min: 0,
    max: 1000,
    description: localeMap('Mass in tonnes', 'Massa em toneladas'),
  },
  {
    name: 'structureCost',
    type: 'integer',
    required: true,
    min: 0,
    max: 1000,
    description: localeMap('Structure points consumed', 'Pontos de estrutura consumidos'),
  },
  {
    name: 'basePrice',
    type: 'integer',
    required: true,
    min: 0,
    max: 1000000,
    description: localeMap('Base purchase price', 'Preço base de compra'),
  },
  {
    name: 'scrapValue',
    type: 'integer',
    required: true,
    min: 0,
    max: 1000000,
    description: localeMap('Scrap sell value', 'Valor de sucata'),
  },
  {
    name: 'partHp',
    type: 'integer',
    required: true,
    min: 1,
    max: 10000,
    description: localeMap('Part hit points', 'Pontos de vida da peça'),
  },
  {
    name: 'pot',
    type: 'float',
    required: false,
    min: 0,
    max: 1000,
    description: localeMap('Potential output', 'Potencial'),
  },
  {
    name: 'pdf',
    type: 'float',
    required: false,
    min: 0,
    max: 1000,
    description: localeMap('Point defense fire', 'Defesa de ponto'),
  },
  {
    name: 'bli',
    type: 'float',
    required: false,
    min: 0,
    max: 1000,
    description: localeMap('Build integrity', 'Integridade da construção'),
  },
  {
    name: 'esc',
    type: 'float',
    required: false,
    min: 0,
    max: 1000,
    description: localeMap('Escape rating', 'Evasão'),
  },
  {
    name: 'sen',
    type: 'float',
    required: false,
    min: 0,
    max: 1000,
    description: localeMap('Sensor rating', 'Sensores'),
  },
  {
    name: 'crg',
    type: 'float',
    required: false,
    min: 0,
    max: 1000,
    description: localeMap('Cargo capacity', 'Capacidade de carga'),
  },
  {
    name: 'min',
    type: 'float',
    required: false,
    min: 0,
    max: 1000,
    description: localeMap('Mining output', 'Mineração'),
  },
  {
    name: 'energyCont',
    type: 'float',
    required: false,
    min: -1000,
    max: 1000,
    description: localeMap('Continuous energy', 'Energia contínua'),
  },
  {
    name: 'energyCombat',
    type: 'float',
    required: false,
    min: -1000,
    max: 1000,
    description: localeMap('Combat energy draw', 'Energia de combate'),
  },
  {
    name: 'fuelCap',
    type: 'integer',
    required: false,
    min: 0,
    max: 100000,
    description: localeMap('Fuel capacity', 'Capacidade de combustível'),
  },
  {
    name: 'fuelUse',
    type: 'float',
    required: false,
    min: 0,
    max: 1000,
    description: localeMap('Fuel use per leg', 'Consumo de combustível'),
  },
  {
    name: 'batCharge',
    type: 'float',
    required: false,
    min: 0,
    max: 10000,
    description: localeMap('Battery charge', 'Carga da bateria'),
  },
  {
    name: 'batOutput',
    type: 'float',
    required: false,
    min: 0,
    max: 10000,
    description: localeMap('Battery output', 'Saída da bateria'),
  },
  {
    name: 'batInput',
    type: 'float',
    required: false,
    min: 0,
    max: 10000,
    description: localeMap('Battery input', 'Entrada da bateria'),
  },
  {
    name: 'specialProp',
    type: 'json',
    required: false,
    description: localeMap('Special properties', 'Propriedades especiais'),
  },
  {
    name: 'connectorLayouts',
    type: 'connector-layout',
    required: false,
    description: localeMap(
      'Candidate connector layouts (one picked at random per instance)',
      'Layouts de conectores candidatos (um sorteado por instância)',
    ),
  },
  {
    name: 'active',
    type: 'boolean',
    required: false,
    description: localeMap('Active and available', 'Ativo e disponível'),
  },
];

const MATERIAL_FIELDS: EntitySchemaField[] = [
  {
    name: 'id',
    type: 'string',
    required: true,
    description: localeMap('Unique material id', 'ID único do material'),
  },
  {
    name: 'displayName',
    type: 'locale-map',
    required: true,
    description: localeMap('Display name by locale', 'Nome de exibição por idioma'),
  },
  {
    name: 'description',
    type: 'locale-map',
    required: true,
    description: localeMap('Description by locale', 'Descrição por idioma'),
  },
  {
    name: 'rarity',
    type: 'enum',
    required: true,
    enumValues: RARITY_VALUES,
    description: localeMap('Rarity tier', 'Raridade'),
  },
  {
    name: 'basePrice',
    type: 'integer',
    required: true,
    min: 1,
    max: 1000000,
    description: localeMap('Base price', 'Preço base'),
  },
  {
    name: 'active',
    type: 'boolean',
    required: false,
    description: localeMap('Active and available', 'Ativo e disponível'),
  },
];

const FACTION_FIELDS: EntitySchemaField[] = [
  {
    name: 'id',
    type: 'string',
    required: true,
    description: localeMap('Unique faction id', 'ID único da facção'),
  },
  {
    name: 'displayName',
    type: 'locale-map',
    required: true,
    description: localeMap('Display name by locale', 'Nome de exibição por idioma'),
  },
  {
    name: 'description',
    type: 'locale-map',
    required: true,
    description: localeMap('Description by locale', 'Descrição por idioma'),
  },
  {
    name: 'color',
    type: 'string',
    required: true,
    description: localeMap('Faction color', 'Cor da facção'),
  },
  {
    name: 'playable',
    type: 'boolean',
    required: false,
    description: localeMap('Playable by users', 'Jogável pelos usuários'),
  },
  {
    name: 'relations',
    type: 'json',
    required: true,
    description: localeMap('Faction relation matrix', 'Matriz de relações da facção'),
  },
  {
    name: 'starterKitHint',
    type: 'json',
    required: false,
    description: localeMap('Starter kit hint', 'Dica de kit inicial'),
  },
];

const LOCATION_FIELDS: EntitySchemaField[] = [
  {
    name: 'id',
    type: 'string',
    required: true,
    description: localeMap('Unique location id', 'ID único do local'),
  },
  {
    name: 'displayName',
    type: 'locale-map',
    required: true,
    description: localeMap('Display name by locale', 'Nome de exibição por idioma'),
  },
  {
    name: 'description',
    type: 'locale-map',
    required: true,
    description: localeMap('Description by locale', 'Descrição por idioma'),
  },
  {
    name: 'type',
    type: 'string',
    required: true,
    description: localeMap('Location type', 'Tipo do local'),
  },
  {
    name: 'x',
    type: 'float',
    required: true,
    description: localeMap('X coordinate', 'Coordenada X'),
  },
  {
    name: 'y',
    type: 'float',
    required: true,
    description: localeMap('Y coordinate', 'Coordenada Y'),
  },
  {
    name: 'zone',
    type: 'integer',
    required: true,
    min: 0,
    max: 3,
    description: localeMap('Danger zone', 'Zona de perigo'),
  },
  {
    name: 'factionId',
    type: 'string',
    required: true,
    description: localeMap('Controlling faction', 'Facção controladora'),
  },
  {
    name: 'isolation',
    type: 'float',
    required: true,
    min: 0,
    max: 10,
    description: localeMap('Isolation multiplier', 'Multiplicador de isolamento'),
  },
  {
    name: 'mood',
    type: 'float',
    required: true,
    min: 0,
    max: 2,
    description: localeMap('Market mood', 'Humor do mercado'),
  },
  {
    name: 'services',
    type: 'json',
    required: true,
    description: localeMap('Available services', 'Serviços disponíveis'),
  },
];

const ROUTE_FIELDS: EntitySchemaField[] = [
  {
    name: 'id',
    type: 'string',
    required: true,
    description: localeMap('Unique route id', 'ID único da rota'),
  },
  {
    name: 'nodeAId',
    type: 'string',
    required: true,
    description: localeMap(
      'First location id (lexicographically smaller)',
      'ID do primeiro local (menor lexicograficamente)',
    ),
  },
  {
    name: 'nodeBId',
    type: 'string',
    required: true,
    description: localeMap(
      'Second location id (lexicographically larger)',
      'ID do segundo local (maior lexicograficamente)',
    ),
  },
  {
    name: 'distance',
    type: 'integer',
    required: true,
    min: 1,
    max: 10000,
    description: localeMap('Route distance', 'Distância da rota'),
  },
  {
    name: 'danger',
    type: 'integer',
    required: true,
    min: 0,
    max: 10,
    description: localeMap('Danger level', 'Nível de perigo'),
  },
];

const ENVIRONMENT_FIELDS: EntitySchemaField[] = [
  {
    name: 'id',
    type: 'string',
    required: true,
    description: localeMap('Unique environment id', 'ID único do ambiente'),
  },
  {
    name: 'displayName',
    type: 'locale-map',
    required: true,
    description: localeMap('Display name by locale', 'Nome de exibição por idioma'),
  },
  {
    name: 'description',
    type: 'locale-map',
    required: true,
    description: localeMap('Description by locale', 'Descrição por idioma'),
  },
  {
    name: 'level',
    type: 'integer',
    required: true,
    min: 1,
    max: 10,
    description: localeMap('Hazard level', 'Nível do perigo'),
  },
  {
    name: 'fuelMult',
    type: 'float',
    required: false,
    min: 0,
    max: 10,
    description: localeMap('Fuel multiplier', 'Multiplicador de combustível'),
  },
  {
    name: 'subsystemTarget',
    type: 'string',
    required: false,
    description: localeMap('Targeted subsystem', 'Subsistema alvo'),
  },
  {
    name: 'mitigatingPart',
    type: 'string',
    required: false,
    description: localeMap('Part that mitigates the hazard', 'Peça que mitiga o perigo'),
  },
];

const MISSION_TEMPLATE_FIELDS: EntitySchemaField[] = [
  {
    name: 'id',
    type: 'string',
    required: true,
    description: localeMap('Unique template id', 'ID único do modelo'),
  },
  {
    name: 'displayName',
    type: 'locale-map',
    required: true,
    description: localeMap('Display name by locale', 'Nome de exibição por idioma'),
  },
  {
    name: 'description',
    type: 'locale-map',
    required: true,
    description: localeMap('Description by locale', 'Descrição por idioma'),
  },
  {
    name: 'type',
    type: 'enum',
    required: true,
    enumValues: MISSION_TYPE_VALUES,
    description: localeMap('Mission type', 'Tipo de missão'),
  },
  {
    name: 'factionId',
    type: 'string',
    required: true,
    description: localeMap('Owning faction', 'Facção dona'),
  },
  {
    name: 'requirements',
    type: 'json',
    required: true,
    description: localeMap('Origin requirements', 'Requisitos de origem'),
  },
  {
    name: 'rewardCalc',
    type: 'json',
    required: false,
    description: localeMap('Reward calculation params', 'Parâmetros de recompensa'),
  },
  {
    name: 'deadlineCalc',
    type: 'json',
    required: false,
    description: localeMap('Deadline calculation params', 'Parâmetros de prazo'),
  },
  {
    name: 'encounterPolicy',
    type: 'json',
    required: false,
    description: localeMap('Encounter policy', 'Política de encontros'),
  },
  {
    name: 'active',
    type: 'boolean',
    required: false,
    description: localeMap('Active and available', 'Ativo e disponível'),
  },
];

const DROP_TABLE_FIELDS: EntitySchemaField[] = [
  {
    name: 'id',
    type: 'string',
    required: true,
    description: localeMap('Unique drop table id', 'ID único da tabela de drops'),
  },
  {
    name: 'source',
    type: 'string',
    required: true,
    description: localeMap('Drop source tag', 'Tag da fonte de drops'),
  },
  {
    name: 'tiers',
    type: 'json',
    required: true,
    description: localeMap('Tier chances', 'Chances por tier'),
  },
];

const SHIP_FORMAT_FIELDS: EntitySchemaField[] = [
  {
    name: 'id',
    type: 'string',
    required: true,
    description: localeMap('Unique format code', 'Código único do formato'),
  },
  {
    name: 'displayName',
    type: 'locale-map',
    required: true,
    description: localeMap('Display name by locale', 'Nome de exibição por idioma'),
  },
  {
    name: 'description',
    type: 'locale-map',
    required: true,
    description: localeMap('Description by locale', 'Descrição por idioma'),
  },
  {
    name: 'cells',
    type: 'grid-cells',
    required: true,
    description: localeMap(
      'Buildable cells, relative to the bridge at [0,0]',
      'Células construíveis, relativas à ponte em [0,0]',
    ),
  },
  {
    name: 'minRarity',
    type: 'enum',
    required: true,
    enumValues: RARITY_VALUES,
    description: localeMap(
      'Minimum bridge rarity that unlocks this format',
      'Raridade mínima de ponte que desbloqueia este formato',
    ),
  },
];

const ENTITY_SCHEMAS: Record<string, EntitySchema> = {
  parts: { entity: 'parts', model: 'partCatalog', fields: PART_FIELDS },
  materials: { entity: 'materials', model: 'material', fields: MATERIAL_FIELDS },
  factions: { entity: 'factions', model: 'faction', fields: FACTION_FIELDS },
  locations: { entity: 'locations', model: 'location', fields: LOCATION_FIELDS },
  routes: { entity: 'routes', model: 'route', fields: ROUTE_FIELDS },
  environments: { entity: 'environments', model: 'environment', fields: ENVIRONMENT_FIELDS },
  'mission-templates': {
    entity: 'mission-templates',
    model: 'missionTemplate',
    fields: MISSION_TEMPLATE_FIELDS,
  },
  'drop-tables': { entity: 'drop-tables', model: 'dropTable', fields: DROP_TABLE_FIELDS },
  'ship-formats': { entity: 'ship-formats', model: 'shipFormat', fields: SHIP_FORMAT_FIELDS },
};

export function getEntityNames(): string[] {
  return Object.keys(ENTITY_SCHEMAS);
}

export function getEntitySchema(entity: string): EntitySchema | undefined {
  return ENTITY_SCHEMAS[entity];
}

export function registerEntitySchemaField(entity: string, field: EntitySchemaField): void {
  const schema = ENTITY_SCHEMAS[entity];
  if (!schema) {
    throw new Error(`Unknown entity: ${entity}`);
  }
  const existingIndex = schema.fields.findIndex((f) => f.name === field.name);
  if (existingIndex >= 0) {
    schema.fields[existingIndex] = field;
  } else {
    schema.fields.push(field);
  }
}
