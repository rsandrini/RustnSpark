import type { PrismaClient } from '@prisma/client';
import type { NodeData, SceneData } from '../../src/dialogue/scenes.js';

/**
 * Default dialogue scenes for the new-pilot opening (Task 8): Bob the friend, Dara the rescuer,
 * Marshal Oren the harbour office (only the port's own business: the refuel, the market, the way back from the rescue). Short, warm, spoken lines, centred on the screen by default.
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
          "Hey. I'm Bob. You look like someone whose ship needs to get somewhere.",
          'Ei. Sou Bob. Você parece alguém cuja nave precisa chegar a algum lugar.',
        ],
        { next: 'k_gift_2', openDelay: 2 },
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
      node(
        'k_gift_done',
        [
          'There. She hums. You did that with your own hands.',
          'Pronto. Ronrona. Você fez isso com suas próprias mãos.',
        ],
        { openDelay: 3.5 },
      ),
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
    ['The engine fails', 'O motor falha'],
    'prologue_race_leg_2',
    9,
    [
      node('k_leg_2', [
        'Something is wrong... the engine is coughing! You are losing speed. Hold on, keep her flying.',
        'Algo está errado... o motor está engasgando! Você está perdendo velocidade. Aguente firme, mantenha ela voando.',
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
    15,
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
    16,
    [
      node('k_choose_done', [
        'Good pick. We will need the right module for it. Buy it here at the port.',
        'Boa escolha. Vamos precisar do módulo certo para ela. Compre aqui no porto.',
      ]),
    ],
  ),
  scene(
    'upgrade',
    ['Pirates ahead', 'Piratas à frente'],
    'prologue_job-report_enter',
    24,
    [
      node(
        'k_upgrade_1',
        [
          'Listen. The lane ahead has pirates, and they shoot everything that flies. Your hull is too thin for that.',
          'Escute. A rota à frente tem piratas, e eles atiram em tudo que voa. Seu casco é fino demais para isso.',
        ],
        { next: 'k_upgrade_2' },
      ),
      node('k_upgrade_2', [
        'Here, take this scrap. It is enough to make the hull stronger. Open the Upgrade tab and do it. Be ready.',
        'Tome esta sucata. Ela basta para deixar o casco mais forte. Abra a aba de Melhorias e faça isso. Esteja preparado.',
      ]),
    ],
  ),
  scene(
    'upgrade_done',
    ['Sturdier', 'Mais resistente'],
    'prologue_upgrade_done',
    28,
    [
      node('k_upgrade_done', [
        'Look at those numbers. She can take a hit now. Let us earn some more.',
        'Olhe esses números. Agora ela aguenta um tiro. Vamos ganhar mais um pouco.',
      ]),
    ],
  ),
  scene(
    'stop_two',
    ['Second job', 'Segundo serviço'],
    'prologue_stop-two_enter',
    29,
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
    'prologue_final-run_enter',
    31,
    [
      node('k_final_board', [
        'One last run. Dangerous lane, but the pay fixes everything. You in?',
        'Uma última viagem. Rota perigosa, mas o pagamento conserta tudo. Vamos?',
      ]),
    ],
  ),
  scene(
    'final_run',
    ['Stay close', 'Fique perto'],
    'prologue_final-run_enter',
    32,
    [
      node('k_final_run', [
        'Stay close. Pirates hunt this lane. We fly through together.',
        'Fique perto. Piratas caçam nessa rota. Vamos atravessar juntos.',
      ]),
    ],
  ),
  scene(
    'final_radar',
    ['Movement on the radar', 'Movimento no radar'],
    'prologue_final-run_radar',
    33,
    [
      node('k_final_radar', [
        'Wait... I am picking up movement ahead on the radar. Stay sharp.',
        'Peraí... estou vendo movimento à frente no radar. Fique atento.',
      ]),
    ],
  ),
  scene(
    'loss',
    ['Bob!', 'Bob!'],
    'prologue_final-run_leg_2',
    34,
    [
      node(
        'k_loss_1',
        [
          'Pirates! They are on us! Break away, I will draw them off!',
          'Piratas! Estão em cima de nós! Fuja, eu vou distraí-los!',
        ],
        { next: 'k_loss_2', openDelay: 3 },
      ),
      node('k_loss_2', [
        '...they hit me... my engines are gone... I am losing... [static]',
        '...me acertaram... meus motores pararam... estou perdendo... [estática]',
      ]),
    ],
  ),
  scene(
    'fit_module',
    ['Fit the module', 'Encaixe o módulo'],
    'prologue_fit-module_enter',
    19,
    [
      node('k_fit_module', [
        'Drag, connect, save. The yard does not bite.',
        'Arraste, conecte, salve. O estaleiro não morde.',
      ]),
    ],
  ),
  scene(
    'fit_module_done',
    ['Ready for the run', 'Pronto para a viagem'],
    'prologue_fit-module_done',
    20,
    [
      node('k_fit_done', [
        'Your ship is ready for the run. Dispatch when you are steady.',
        'Sua nave está pronta para a viagem. Despache quando estiver firme.',
      ]),
    ],
  ),
  scene(
    'dispatch_job',
    ['Send her out', 'Mande-a partir'],
    'prologue_dispatch-job_enter',
    21,
    [
      node('k_dispatch', [
        'Press dispatch. She will fly while you breathe.',
        'Aperte partir. Ela vai voar enquanto você respira.',
      ]),
    ],
  ),
  scene(
    'dispatch_job_done',
    ['Away', 'Partiu'],
    'prologue_dispatch-job_done',
    22,
    [
      node('k_dispatch_done', [
        'She is away. The report will be here when she returns.',
        'Ela partiu. O relatório estará aqui quando ela voltar.',
      ]),
    ],
  ),
  scene(
    'job_report',
    ['Job done', 'Serviço feito'],
    'prologue_job-report_enter',
    23,
    [
      node('k_job_report', [
        'Job done. Credits in hand. This is how a ship earns her keep.',
        'Serviço feito. Créditos em mãos. É assim que uma nave ganha a vida.',
      ]),
    ],
  ),
  scene(
    'job_report_done',
    ['Enough for one more', 'O suficiente para mais uma'],
    'prologue_job-report_done',
    25,
    [
      node('k_job_report_done', [
        'One more like that and you will have enough to make her truly yours.',
        'Mais uma dessas e você terá o suficiente para fazê-la realmente sua.',
      ]),
    ],
  ),
  scene(
    'repair',
    ['The flight wore her down', 'O voo a desgastou'],
    'prologue_repair_enter',
    26,
    [
      node('k_repair', [
        'Look at her. That run took a toll: the parts are worn. Open Repair and pay the workshop, so she does not give out when we need her most.',
        'Olha só. Esse voo cobrou seu preço: as peças estão gastas. Abra Reparo e pague a oficina, para ela não falhar quando mais precisarmos.',
      ]),
    ],
  ),
  scene(
    'repair_done',
    ['Good as new', 'Como nova'],
    'prologue_repair_done',
    27,
    [
      node('k_repair_done', [
        'Good as new. Now she can take whatever comes. One more thing before the big run: the hull.',
        'Como nova. Agora ela aguenta o que vier. Mais uma coisa antes da corrida grande: o casco.',
      ]),
    ],
  ),
  scene(
    'stop_two_done',
    ['Good run', 'Boa viagem'],
    'prologue_stop-two_done',
    30,
    [
      node('k_stop_two_done', [
        'Good run. One more to go, then we talk about your future.',
        'Boa viagem. Mais uma e aí conversamos sobre seu futuro.',
      ]),
    ],
  ),
  scene(
    'buy_module',
    ['Buy the module', 'Compre o módulo'],
    'prologue_buy-module_enter',
    17,
    [
      node('k_buy_module', [
        'Buy what your job needs. People ride in a cabin, and a cabin only works with life support, so take both. Crates go in the cargo hold.',
        'Compre o que seu serviço precisa. Pessoas viajam numa cabine, e a cabine só funciona com suporte de vida, então leve os dois. Caixas vão no porão de carga.',
      ]),
    ],
  ),
  scene(
    'buy_module_done',
    ['Paid for', 'Pago'],
    'prologue_buy-module_done',
    18,
    [
      node('k_buy_done', [
        'Paid for. Now fit it the same way you fitted the engine.',
        'Pago. Agora encaixe do mesmo jeito que encaixou o motor.',
      ]),
    ],
  ),
];

const DARA: SceneData[] = [
  scene(
    'rescue',
    ['Found you', 'Encontramos você'],
    'prologue_rescue_enter',
    37,
    [
      node(
        'd_rescue_1',
        [
          'This is Dara Voss, rescue cutter. Your beacon was the only signal in the lane. We have you.',
          'Aqui é Dara Voss, cortador de resgate. Seu sinal era o único na rota. Pegamos você.',
        ],
        { next: 'd_rescue_2' },
      ),
      node('d_rescue_2', [
        'We are pulling you aboard. You are alive. We searched for Bob and found only wreckage. Bob did not make it. I am so sorry.',
        'Estamos puxando você para bordo. Você está vivo. Procuramos Bob e só achamos destroços. Bob não sobreviveu. Sinto muito.',
      ]),
    ],
  ),
  scene(
    'rescue_done',
    ['Come aboard', 'Suba a bordo'],
    'prologue_rescue_done',
    38,
    [
      node('d_rescue_done', [
        'Come aboard when you are ready. There is someone at the harbour who needs to talk to you.',
        'Suba a bordo quando estiver pronto. Tem alguém no porto que precisa falar com você.',
      ]),
    ],
  ),
  scene(
    'final_run_done',
    ['You made it', 'Você conseguiu'],
    'prologue_loss_enter',
    35,
    [
      node('d_final_done', [
        'You were rescued. Your friend was not. The pirates are the reason. I am sorry.',
        'Você foi resgatado. Sua amiga não. Os piratas são o motivo. Sinto muito.',
      ]),
    ],
  ),
  scene(
    'loss_done',
    ['The rescue is here', 'O resgate chegou'],
    'prologue_loss_done',
    36,
    [
      node(
        'd_loss_1',
        [
          'Hey kid, can you breathe? The rescue is here.',
          'Ei você, consegue respirar? O resgate chegou.',
        ],
        { next: 'd_loss_2' },
      ),
      node(
        'd_loss_2',
        [
          'The pirates hit you both. Your ship is wrecked and drifting. At least we got here in time.',
          'Os piratas atingiram vocês dois. Sua nave está destruída e à deriva. Ainda bem que chegamos a tempo.',
        ],
        { next: 'd_loss_3' },
      ),
      node(
        'd_loss_3',
        [
          'Stay with me. We are pulling you out of the wreckage. Help over here, everyone! There is a survivor.',
          'Fique comigo. Vamos te tirar dos destroços. Ajuda aqui, pessoal! Tem um sobrevivente.',
        ],
        { next: 'd_loss_4' },
      ),
      node('d_loss_4', [
        "Bob's signal has stopped answering. There is nothing left of her. I am sorry.",
        'O sinal da Bob parou de responder. Não sobrou nada dela. Me desculpe.',
      ]),
    ],
  ),
];

const OREN: SceneData[] = [
  scene(
    'stop_port_done',
    ['Tank full', 'Tanque cheio'],
    'prologue_stop-port_done',
    14,
    [
      node('o_refuel_done', [
        'Tank full. Good. Now you can reach the board.',
        'Tanque cheio. Bom. Agora você pode chegar ao quadro.',
      ]),
    ],
  ),
  scene(
    'choose_faction',
    ['Choose who you fight with', 'Escolha com quem lutar'],
    'prologue_rescue_done',
    39,
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
  'repair',
  'upgrade',
  'stop-two',
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
