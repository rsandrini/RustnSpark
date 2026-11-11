import type {
  DialogueState,
  DisplayResponse,
  FactionsResponse,
  InventoryItem,
  LocalizedText,
  MaterialsResponse,
  MyStatsResponse,
  PartCatalogListItem,
  ShipFormat,
  SystemNoticesResponse,
  TutorialProgress,
} from '../../../api/generated';
import { PROLOGUE_CELLS, PROLOGUE_PLACES, type ProloguePart } from '../prologue-fixtures';
import type { SandboxPart } from './sandbox-state';
import { SANDBOX_DESCRIPTIONS } from './sandbox-world';

/** The words the screens show for a part, from the seeded catalog (the first sentences). */
const DESCRIPTIONS: Record<string, LocalizedText> = {
  bridge: {
    en: 'The command core of your ship. Every ship needs exactly one. It keeps the pilot alive if the rest of the ship is lost.',
    'pt-BR':
      'O núcleo de comando da sua nave. Toda nave precisa de exatamente uma. Ela mantém o piloto vivo se o resto da nave for perdido.',
  },
  engine_chem_small: {
    en: 'A light rocket engine that moves the ship. It burns fuel, so you also need a fuel tank. Cheap and thrifty, but too weak to push a heavy ship fast.',
    'pt-BR':
      'Um motor a foguete leve que move a nave. Ele queima combustível, então você também precisa de um tanque. Barato e econômico, mas fraco demais para mover uma nave pesada rápido.',
  },
  tank_small: {
    en: 'Holds your fuel. Every chemical engine burns fuel, so a ship with one needs at least one tank.',
    'pt-BR':
      'Guarda o seu combustível. Todo motor químico queima combustível, então uma nave com um precisa de pelo menos um tanque.',
  },
  hull: {
    en: 'A cheap, light structural frame: plenty of hit points, but no armor at all.',
    'pt-BR': 'Uma estrutura barata e leve: muitos pontos de vida, mas nenhuma blindagem.',
  },
  cargo: {
    en: 'Cargo space. Each hold adds capacity for deliveries, so more holds mean bigger, better-paid jobs.',
    'pt-BR':
      'Espaço de carga. Cada compartimento aumenta a capacidade para entregas, então mais compartimentos significam trabalhos maiores e mais bem pagos.',
  },
};

export function descriptionOf(part: ProloguePart): LocalizedText {
  return (
    DESCRIPTIONS[part.catalog.partType] ?? SANDBOX_DESCRIPTIONS[part.catalog.partType] ?? part.name
  );
}

/** A part the pilot owns, as the inventory endpoint lists it. */
export function inventoryItemOf(entry: SandboxPart, shipId: string): InventoryItem {
  return {
    id: entry.id,
    partType: entry.part.catalog.partType,
    displayName: entry.part.name,
    description: descriptionOf(entry.part),
    rarity: entry.part.rarity,
    condition: 100,
    broken: false,
    location: entry.location,
    shipId: entry.location === 'INSTALLED' ? shipId : null,
    catalog: entry.part.catalog,
    connectors: [...entry.part.connectors],
  };
}

export const SANDBOX_FORMAT_ID = 'classic_square';

export const SANDBOX_FORMATS: ShipFormat[] = [
  {
    id: SANDBOX_FORMAT_ID,
    displayName: { en: 'Classic Square', 'pt-BR': 'Quadrado Clássico' },
    description: { en: 'The original start pack', 'pt-BR': 'Grade básica 1' },
    cells: PROLOGUE_CELLS.map(([x, y]) => [x, y]),
    minRarity: 'COMMON',
    minBridgeSize: 1,
  },
];

export const SANDBOX_DISPLAY: DisplayResponse = {
  statScale: 10,
  mobFactor: 1.6,
  scavengeHandicap: 0.5,
  scavengeFootFactor: 0.5,
  shieldRegen: 2,
  armorPoolFactor: 5,
  armorReduction: 0.25,
};

export const SANDBOX_FACTIONS: FactionsResponse = {
  factions: [
    {
      id: 'free',
      displayName: { en: 'Free pilots', 'pt-BR': 'Pilotos livres' },
      description: {
        en: 'Pilots who fly for nobody.',
        'pt-BR': 'Pilotos que não voam para ninguém.',
      },
      color: '#9aa4b2',
      playable: false,
      art: null,
    },
  ],
};

export const SANDBOX_NOTICES: SystemNoticesResponse = { items: [] };

/** The opening has no tutorial checklist and no mentor: the director is the guide. */
export const SANDBOX_DIALOGUE: DialogueState = { enabled: false, scene: null, replayable: [] };

export const SANDBOX_STATS: MyStatsResponse = {
  totals: {},
  records: {},
  firstMissionAt: null,
  lastActiveAt: null,
};

export const SANDBOX_TUTORIAL_PROGRESS: TutorialProgress = {
  refuelled: false,
  repaired: false,
  worked: false,
  missionTaken: false,
  dispatched: false,
};

export const SANDBOX_MATERIALS: MaterialsResponse = {
  locationId: PROLOGUE_PLACES.home,
  materials: [],
};

export function catalogListOf(parts: readonly ProloguePart[]): PartCatalogListItem[] {
  return parts.map((part) => ({
    partType: part.catalog.partType,
    displayName: part.name.en,
    partClass: part.catalog.partClass,
  }));
}
