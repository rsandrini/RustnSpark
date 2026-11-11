import type { PrismaClient } from '@prisma/client';
import type { NodeData, SceneData } from '../../src/dialogue/scenes.js';

/**
 * Default dialogue scenes for the new-pilot opening (Task 8): Kite the friend, Dara the rescuer,
 * Marshal Oren the harbour office. Short, warm, spoken lines, centred on the screen by default.
 * Admin owns them once seeded; these are only the starting words.
 */

type Pair = readonly [en: string, ptBR: string];

const loc = (pair: Pair) => ({ en: pair[0], 'pt-BR': pair[1] });

const node = (id: string, text: Pair, extra: Partial<NodeData> = {}): NodeData => ({
  id,
  text: loc(text),
  position: 'center',
  anchor: null,
  blocking: true,
  next: null,
  choices: [],
  ...extra,
});

const scene = (
  id: string,
  title: Pair,
  trigger: string,
  order: number,
  nodes: NodeData[],
): SceneData => ({
  id,
  title: loc(title),
  trigger: trigger as SceneData['trigger'],
  order,
  start: nodes[0]?.id ?? id,
  nodes,
});

const KITE: SceneData[] = [
  scene(
    'gift',
    ['A friend with an engine', 'Um amigo com um motor'],
    'prologue_gift_enter',
    1,
    [
      node(
        'k_gift_1',
        [
          "Hey. I'm Kite. You look like someone whose ship needs to get somewhere.",
          'Ei. Sou Kite. Você parece alguém cuja nave precisa chegar a algum lugar.',
        ],
        { next: 'k_gift_2' },
      ),
      node('k_gift_2', [
        "Here's an old engine. Worn, but honest. Drag it onto your grid and let's hear her hum.",
        'Aqui está um motor velho. Gasto, mas honesto. Arraste-o para sua grade e vamos ouvi-lo ronronar.',
      ]),
    ],
  ),
  scene(
    'gift_done',
    ['She hums', 'Ele ronrona'],
    'prologue_gift_done',
    2,
    [
      node('k_gift_done', [
        'There. She hums. You did that with your own hands.',
        'Pronto. Ronrona. Você fez isso com suas próprias mãos.',
      ]),
    ],
  ),
  scene(
    'fit_engine',
    ['Fit the engine', 'Encaixe o motor'],
    'prologue_fit-engine_enter',
    3,
    [
      node(
        'k_fit_1',
        [
          'Drag the engine onto the grid. The little markers show where it wants to touch the ship.',
          'Arraste o motor para a grade. Os marcadores mostram onde ele quer tocar a nave.',
        ],
        { next: 'k_fit_2' },
      ),
      node('k_fit_2', [
        'If it does not fit, it will tell you why. Keep it there and fix it. No need to start over.',
        'Se não encaixar, ele vai te dizer por quê. Deixe-o ali e conserte. Não precisa começar de novo.',
      ]),
    ],
  ),
  scene(
    'fit_engine_done',
    ['Fitted', 'Encaixado'],
    'prologue_fit-engine_done',
    4,
    [
      node('k_fit_done', [
        'Fitted. You just made a ship that can fly. Not many people can say that today.',
        'Encaixado. Você acabou de fazer uma nave que pode voar. Poucos podem dizer isso hoje.',
      ]),
    ],
  ),
  scene(
    'race_board',
    ['A little race', 'Uma corridinha'],
    'prologue_race-board_enter',
    5,
    [
      node('k_race_board', [
        "I set up a small race. Just you and me. Don't worry about winning yet; just feel the ship.",
        'Arrumei uma corridinha. Só eu e você. Não se preocupe em ganhar ainda; só sinta a nave.',
      ]),
    ],
  ),
  scene(
    'race_board_done',
    ['Lined up', 'Alistados'],
    'prologue_race-board_done',
    6,
    [
      node('k_race_board_done', [
        'Ready? I will be right beside you. Three short legs, then a cold drink.',
        'Pronto? Vou ficar bem ao seu lado. Três trechos curtos, depois um drink gelado.',
      ]),
    ],
  ),
  scene(
    'race_start',
    ['Go', 'Vai'],
    'prologue_race_enter',
    7,
    [
      node('k_race_start', [
        'Three legs. Keep her steady and she will carry you.',
        'Três trechos. Mantenha firme e ela vai te levar.',
      ]),
    ],
  ),
  scene(
    'race_leg_1',
    ['First leg', 'Primeiro trecho'],
    'prologue_race_leg_1',
    8,
    [
      node('k_leg_1', [
        'First leg down. You are keeping up. That is better than most first-timers.',
        'Primeiro trecho feito. Você está acompanhando. É melhor que a maioria dos estreantes.',
      ]),
    ],
  ),
  scene(
    'race_leg_2',
    ['Halfway', 'Metade'],
    'prologue_race_leg_2',
    9,
    [
      node('k_leg_2', [
        'Halfway there. The ship likes you. That helps more than raw speed.',
        'Na metade. A nave gosta de você. Isso ajuda mais que velocidade pura.',
      ]),
    ],
  ),
  scene(
    'race_leg_3',
    ['Last leg', 'Último trecho'],
    'prologue_race_leg_3',
    10,
    [
      node('k_leg_3', [
        'Last leg. Push a little if you want, but do not break her. I will see you at the line.',
        'Último trecho. Aperte um pouco se quiser, mas não quebre ela. Te vejo na linha.',
      ]),
    ],
  ),
  scene(
    'race_report',
    ['At the line', 'Na linha'],
    'prologue_race-report_enter',
    11,
    [
      node('k_race_report', [
        'I crossed first. You were close. Next time, the win is yours.',
        'Cruzei primeiro. Você estava perto. Da próxima, a vitória é sua.',
      ]),
    ],
  ),
  scene(
    'race_report_done',
    ['First winnings', 'Primeiros ganhos'],
    'prologue_race-report_done',
    12,
    [
      node('k_race_report_done', [
        'Good money. Refuel, then pick a job. We will earn more together.',
        'Bom dinheiro. Reabasteça, depois escolha um serviço. Vamos ganhar mais juntos.',
      ]),
    ],
  ),
  scene(
    'stop_port',
    ['First stop', 'Primeira parada'],
    'prologue_stop-port_enter',
    13,
    [
      node('k_stop_port', [
        'First stop. Fill the tank, look at the board, and choose what calls to you.',
        'Primeira parada. Encha o tanque, olhe o quadro e escolha o que te chamar.',
      ]),
    ],
  ),
  scene(
    'choose_job',
    ['What calls to you', 'O que te chama'],
    'prologue_choose-job_enter',
    14,
    [
      node('k_choose', [
        'Passengers or cargo. Different work, same pay. What feels right for your ship?',
        'Passageiros ou carga. Trabalho diferente, mesmo pagamento. O que parece certo para sua nave?',
      ]),
    ],
  ),
  scene(
    'choose_job_done',
    ['That one', 'Essa'],
    'prologue_choose-job_done',
    15,
    [
      node('k_choose_done', [
        'Good pick. We will need the right module for it. Buy it here at the port.',
        'Boa escolha. Vamos precisar do módulo certo para ela. Compre aqui no porto.',
      ]),
    ],
  ),
  scene(
    'stop_two',
    ['Second job', 'Segundo serviço'],
    'prologue_stop-two_enter',
    16,
    [
      node('k_stop_two', [
        'Second job, different place. Same deal: we fly together, earn enough to improve both ships.',
        'Segundo serviço, lugar diferente. Mesmo acordo: voamos juntos, ganhamos o suficiente para melhorar as duas naves.',
      ]),
    ],
  ),
  scene(
    'final_board',
    ['One last run', 'Uma última viagem'],
    'prologue_final-board_enter',
    17,
    [
      node('k_final_board', [
        'One last run. Dangerous lane, but the pay fixes everything. You in?',
        'Uma última viagem. Rota perigosa, mas o pagamento conserta tudo. Vamos?',
      ]),
    ],
  ),
  scene(
    'final_board_done',
    ['Both ships fixed', 'As duas naves consertadas'],
    'prologue_final-board_done',
    18,
    [
      node('k_final_board_done', [
        'Let us earn enough to make both ships faster. Then we plan the next race.',
        'Vamos ganhar o suficiente para deixar as duas naves mais rápidas. Depois planejamos a próxima corrida.',
      ]),
    ],
  ),
  scene(
    'final_run',
    ['Stay close', 'Fique perto'],
    'prologue_final-run_enter',
    19,
    [
      node('k_final_run', [
        'Stay close. This lane has pirates. We fly through together.',
        'Fique perto. Essa rota tem piratas. Vamos atravessar juntos.',
      ]),
    ],
  ),
  scene(
    'loss',
    ['Kite!', 'Kite!'],
    'prologue_loss_enter',
    20,
    [
      node(
        'k_loss_1',
        [
          'Kite! Watch out!',
          'Kite! Cuidado!',
        ],
        { next: 'k_loss_2' },
      ),
      node('k_loss_2', [
        '...static...',
        '...estática...',
      ]),
    ],
  ),
  scene(
    'loss_done',
    ['Gone', 'Se foi'],
    'prologue_loss_done',
    21,
    [
      node('k_loss_done', [
        'Kite is gone. Your ship made it through. But Kite...',
        'Kite se foi. Sua nave passou. Mas Kite...',
      ]),
    ],
  ),
];

const DARA: SceneData[] = [
  scene(
    'rescue',
    ['Found you', 'Encontramos você'],
    'prologue_rescue_enter',
    30,
    [
      node(
        'd_rescue_1',
        [
          'This is Dara Voss, rescue crew. We found you drifting.',
          'Aqui é Dara Voss, equipe de resgate. Encontramos você à deriva.',
        ],
        { next: 'd_rescue_2' },
      ),
      node('d_rescue_2', [
        'Only you came out of that lane. I am so sorry.',
        'Só você saiu dessa rota. Sinto muito.',
      ]),
    ],
  ),
  scene(
    'rescue_done',
    ['Come aboard', 'Suba a bordo'],
    'prologue_rescue_done',
    31,
    [
      node('d_rescue_done', [
        'Come aboard when you are ready. There is someone at the harbour who needs to talk to you.',
        'Suba a bordo quando estiver pronto. Tem alguém no porto que precisa falar com você.',
      ]),
    ],
  ),
];

const OREN: SceneData[] = [
  scene(
    'stop_port_done',
    ['Tank full', 'Tanque cheio'],
    'prologue_stop-port_done',
    40,
    [
      node('o_refuel_done', [
        'Tank full. Good. Now you can reach the board.',
        'Tanque cheio. Bom. Agora você pode chegar ao quadro.',
      ]),
    ],
  ),
  scene(
    'buy_module',
    ['Buy the module', 'Compre o módulo'],
    'prologue_buy-module_enter',
    41,
    [
      node('o_buy_module', [
        'Buy the module your job needs. Passenger cabin for people, cargo hold for crates.',
        'Compre o módulo que seu serviço precisa. Cabine de passageiros para pessoas, porão de carga para caixas.',
      ]),
    ],
  ),
  scene(
    'buy_module_done',
    ['Paid for', 'Pago'],
    'prologue_buy-module_done',
    42,
    [
      node('o_buy_done', [
        'Paid for. Now fit it the same way you fitted the engine.',
        'Pago. Agora encaixe do mesmo jeito que encaixou o motor.',
      ]),
    ],
  ),
  scene(
    'fit_module',
    ['Fit the module', 'Encaixe o módulo'],
    'prologue_fit-module_enter',
    43,
    [
      node('o_fit_module', [
        'Drag, connect, save. The yard does not bite.',
        'Arraste, conecte, salve. O estaleiro não morde.',
      ]),
    ],
  ),
  scene(
    'fit_module_done',
    ['Ready for the run', 'Pronto para a viagem'],
    'prologue_fit-module_done',
    44,
    [
      node('o_fit_done', [
        'Your ship is ready for the run. Dispatch when you are steady.',
        'Sua nave está pronta para a viagem. Despache quando estiver firme.',
      ]),
    ],
  ),
  scene(
    'dispatch_job',
    ['Send her out', 'Mande-a partir'],
    'prologue_dispatch-job_enter',
    45,
    [
      node('o_dispatch', [
        'Press dispatch. She will fly while you breathe.',
        'Aperte partir. Ela vai voar enquanto você respira.',
      ]),
    ],
  ),
  scene(
    'dispatch_job_done',
    ['Away', 'Partiu'],
    'prologue_dispatch-job_done',
    46,
    [
      node('o_dispatch_done', [
        'She is away. The report will be here when she returns.',
        'Ela partiu. O relatório estará aqui quando ela voltar.',
      ]),
    ],
  ),
  scene(
    'job_report',
    ['Job done', 'Serviço feito'],
    'prologue_job-report_enter',
    47,
    [
      node('o_job_report', [
        'Job done. Credits in hand. This is how a ship earns her keep.',
        'Serviço feito. Créditos em mãos. É assim que uma nave ganha a vida.',
      ]),
    ],
  ),
  scene(
    'job_report_done',
    ['Enough for one more', 'O suficiente para mais uma'],
    'prologue_job-report_done',
    48,
    [
      node('o_job_report_done', [
        'One more like that and you will have enough to make her truly yours.',
        'Mais uma dessas e você terá o suficiente para fazê-la realmente sua.',
      ]),
    ],
  ),
  scene(
    'stop_two_done',
    ['Good run', 'Boa viagem'],
    'prologue_stop-two_done',
    49,
    [
      node('o_stop_two_done', [
        'Good run. One more to go, then we talk about your future.',
        'Boa viagem. Mais uma e aí conversamos sobre seu futuro.',
      ]),
    ],
  ),
  scene(
    'final_run_done',
    ['You made it', 'Você conseguiu'],
    'prologue_final-run_done',
    50,
    [
      node('o_final_done', [
        'You made it back. Your friend did not. I am sorry.',
        'Você conseguiu voltar. Seu amigo não. Sinto muito.',
      ]),
    ],
  ),
  scene(
    'choose_faction',
    ['Choose who you fight with', 'Escolha com quem lutar'],
    'prologue_rescue_done',
    51,
    [
      node('o_choose_faction', [
        'The three powers are fighting the pirates. You can fly under one flag. Choose who you fight with.',
        'Os três poderes estão lutando contra os piratas. Você pode voar sob uma bandeira. Escolha com quem lutar.',
      ]),
    ],
  ),
];

export const PROLOGUE_SCENES: Readonly<Record<string, readonly SceneData[]>> = {
  free_mentor_kite: KITE,
  free_mentor_dara: DARA,
  free_mentor_oren: OREN,
};

/** Every step that must have at least one scene, checked by the seed coverage test. */
export const PROLOGUE_STEPS = [
  'gift',
  'fit-engine',
  'race-board',
  'race',
  'race-report',
  'stop-port',
  'choose-job',
  'buy-module',
  'fit-module',
  'dispatch-job',
  'job-report',
  'stop-two',
  'final-board',
  'final-run',
  'loss',
  'rescue',
] as const;

/**
 * Gives each prologue guide their default scenes while the column is still empty. Admin owns the
 * rows once seeded; this only sets the starting content.
 */
export function defaultScenesFor(giverId: string): readonly SceneData[] | undefined {
  return PROLOGUE_SCENES[giverId];
}

/**
 * Seeds the default prologue scenes into the free faction mentors. A guide that already has scenes
 * is left exactly as it is.
 */
export async function seedPrologueScenes(prisma: PrismaClient): Promise<void> {
  for (const [giverId, scenes] of Object.entries(PROLOGUE_SCENES)) {
    await prisma.$executeRaw`
      UPDATE "QuestGiver" SET "scenes" = ${JSON.stringify(scenes)}::jsonb
      WHERE "id" = ${giverId} AND "scenes" = '[]'::jsonb
    `;
  }
}
