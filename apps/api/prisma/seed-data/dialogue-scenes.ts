import type { PrismaClient } from '@prisma/client';
import type { NodeData, SceneData } from '../../src/dialogue/scenes.js';

/**
 * The dialogue scenes each faction mentor speaks (docs/design/mentor-dialogue-plan.md): the same six scenes in every
 * faction, in the leader's own voice, English and Portuguese. Admin owns them once seeded. The skeleton (which node
 * leads where, where the popup sits, what it points at) is shared; the words are the faction's own.
 */
type Pair = readonly [en: string, ptBR: string];

interface Voice {
  readonly name: string;
  readonly factionLabel: Pair;
  readonly text: {
    // welcome
    readonly w1: Pair;
    readonly w2: Pair;
    readonly wLore: Pair;
    readonly w3: Pair;
    readonly w4: Pair;
    // first ship
    readonly s1: Pair;
    readonly s2: Pair;
    readonly s3: Pair;
    readonly sConn: Pair;
    // first flight
    readonly f1: Pair;
    readonly f2: Pair;
    readonly f3: Pair;
    // after the first report
    readonly r1: Pair;
    readonly r2: Pair;
    readonly r3: Pair;
    // low fuel, first failure
    readonly l1: Pair;
    readonly x1: Pair;
    readonly x2: Pair;
  };
}

const loc = (pair: Pair) => ({ en: pair[0], 'pt-BR': pair[1] });

const LABELS = {
  next: ['Continue', 'Continuar'],
  lore: ['Tell me about the faction', 'Fale sobre a facção'],
  whatNow: ['What do I do now?', 'O que eu faço agora?'],
  showShip: ['Show me the ship', 'Mostre-me a nave'],
  connections: ['What are connections?', 'O que são conexões?'],
  gotIt: ['Got it', 'Entendi'],
  toRefuel: ['Take me to Refuel', 'Leve-me ao Reabastecimento'],
  toMissions: ['Take me to Missions', 'Leve-me às Missões'],
  toPort: ['Take me to the Port', 'Leve-me ao Porto'],
  whatAccept: ['Which one do I accept?', 'Qual eu aceito?'],
  later: ['Later', 'Depois'],
  next2: ['Next', 'Próximo'],
  manage: ['I will manage', 'Eu me viro'],
} as const satisfies Record<string, Pair>;

const node = (
  id: string,
  text: Pair,
  position: NodeData['position'],
  extra: Partial<Pick<NodeData, 'anchor' | 'blocking' | 'next' | 'choices'>> = {},
): NodeData => ({
  id,
  text: loc(text),
  position,
  anchor: extra.anchor ?? null,
  blocking: extra.blocking ?? false,
  next: extra.next ?? null,
  choices: extra.choices ?? [],
});

const choice = (label: Pair, next: string | null, action: string | null = null) => ({
  label: loc(label),
  next,
  action,
});

function scenes(voice: Voice): SceneData[] {
  const t = voice.text;
  return [
    {
      id: 'welcome',
      title: loc(['The welcome', 'As boas-vindas']),
      trigger: 'onboarded',
      order: 1,
      start: 'w1',
      nodes: [
        node('w1', t.w1, 'center', { blocking: true, next: 'w2' }),
        node('w2', t.w2, 'center', {
          blocking: true,
          choices: [
            choice(
              [`Tell me about ${voice.factionLabel[0]}`, `Fale sobre ${voice.factionLabel[1]}`],
              'w_lore',
            ),
            choice(LABELS.whatNow, 'w3'),
          ],
        }),
        node('w_lore', t.wLore, 'center', {
          blocking: true,
          choices: [choice(LABELS.whatNow, 'w3')],
        }),
        node('w3', t.w3, 'center', { blocking: true, next: 'w4' }),
        node('w4', t.w4, 'center', {
          blocking: true,
          choices: [choice(LABELS.showShip, null, 'end')],
        }),
      ],
    },
    {
      id: 'first_ship',
      title: loc(['Your first ship', 'Sua primeira nave']),
      trigger: 'onboarded',
      order: 2,
      start: 's1',
      nodes: [
        node('s1', t.s1, 'left', { anchor: 'ship_grid', next: 's2' }),
        node('s2', t.s2, 'left', { anchor: 'ship_grid', next: 's3' }),
        node('s3', t.s3, 'bottom', {
          anchor: 'auto_layout',
          choices: [choice(LABELS.connections, 's_conn'), choice(LABELS.gotIt, null, 'end')],
        }),
        node('s_conn', t.sConn, 'bottom', {
          anchor: 'ship_grid',
          choices: [choice(LABELS.gotIt, null, 'end')],
        }),
      ],
    },
    {
      id: 'first_flight',
      title: loc(['The first flight', 'O primeiro voo']),
      trigger: 'ship_built',
      order: 3,
      start: 'f1',
      nodes: [
        node('f1', t.f1, 'bottom', {
          anchor: 'port_tab',
          choices: [
            choice(LABELS.toRefuel, null, 'goto:/port?tab=refuel'),
            choice(LABELS.next2, 'f2'),
          ],
        }),
        node('f2', t.f2, 'bottom', {
          anchor: 'missions_tab',
          choices: [
            choice(LABELS.toMissions, null, 'goto:/missions'),
            choice(LABELS.whatAccept, 'f3'),
            choice(LABELS.later, null, 'end'),
          ],
        }),
        node('f3', t.f3, 'right', {
          anchor: 'accept_button',
          choices: [choice(LABELS.gotIt, null, 'end')],
        }),
      ],
    },
    {
      id: 'after_first_report',
      title: loc(['After the first report', 'Depois do primeiro relatório']),
      trigger: 'first_mission_done',
      order: 4,
      start: 'r1',
      nodes: [
        node('r1', t.r1, 'bottom', { next: 'r2' }),
        node('r2', t.r2, 'bottom', { next: 'r3' }),
        node('r3', t.r3, 'bottom', {
          choices: [choice(LABELS.toPort, null, 'goto:/port'), choice(LABELS.gotIt, null, 'end')],
        }),
      ],
    },
    {
      id: 'low_fuel',
      title: loc(['A low tank', 'Tanque baixo']),
      trigger: 'low_fuel',
      order: 5,
      start: 'l1',
      nodes: [
        node('l1', t.l1, 'bottom', {
          anchor: 'port_tab',
          choices: [
            choice(LABELS.toRefuel, null, 'goto:/port?tab=refuel'),
            choice(LABELS.later, null, 'end'),
          ],
        }),
      ],
    },
    {
      id: 'first_failure',
      title: loc(['After a lost mission', 'Depois de uma missão perdida']),
      trigger: 'first_failure',
      order: 6,
      start: 'x1',
      nodes: [
        node('x1', t.x1, 'center', { blocking: true, next: 'x2' }),
        node('x2', t.x2, 'bottom', {
          choices: [choice(LABELS.toPort, null, 'goto:/port'), choice(LABELS.manage, null, 'end')],
        }),
      ],
    },
  ];
}

const LUNA: Voice = {
  name: 'Ines Moura',
  factionLabel: ['the Authority', 'a Autoridade'],
  text: {
    w1: [
      'Welcome to Ceres, pilot. I am Ines Moura, Dockmaster. Every ship that leaves this port leaves with my signature on its papers.',
      'Bem-vindo a Ceres, piloto. Sou Ines Moura, Mestra de Docas. Toda nave que sai deste porto leva minha assinatura nos papéis.',
    ],
    w2: [
      'The Luna Authority keeps the lanes open and the freight moving. We are not glamorous. We are reliable, and reliable pays.',
      'A Autoridade de Luna mantém as rotas abertas e o frete em movimento. Não somos glamourosos. Somos confiáveis, e confiável paga.',
    ],
    wLore: [
      'Before the Authority, every captain filed their own claims and fought their own wars over a delayed crate. Now there is one seal, one set of rules, and a lane that is safe because someone is paid to keep it safe.',
      'Antes da Autoridade, cada capitão registrava suas próprias queixas e brigava por uma caixa atrasada. Agora há um selo, um conjunto de regras e uma rota segura porque alguém é pago para mantê-la segura.',
    ],
    w3: [
      'You fly contracts: deliveries, passengers, escorts, rescues, the occasional race. You are paid when you arrive. You pay for fuel and repairs. What is left is yours to put back into the ship.',
      'Você voa contratos: entregas, passageiros, escoltas, resgates, uma corrida de vez em quando. Recebe ao chegar. Paga combustível e reparos. O que sobra é seu para investir na nave.',
    ],
    w4: [
      'First, your ship. A pilot who knows their ship does not need rescuing. Let me show you.',
      'Primeiro, sua nave. Piloto que conhece a própria nave não precisa ser resgatado. Deixe-me mostrar.',
    ],
    s1: [
      'This is your ship, laid out on the grid. The Bridge in the middle is the heart: lose it and the ship is lost.',
      'Esta é sua nave, desenhada na grade. A Ponte no meio é o coração: perca-a e a nave está perdida.',
    ],
    s2: [
      'Engine to move, tank for fuel, cargo hold for freight, panel and battery for power. Each part does its one job.',
      'Motor para mover, tanque para combustível, porão para carga, painel e bateria para energia. Cada peça faz o seu trabalho.',
    ],
    s3: [
      'Press Auto layout and the yard places everything sensibly. You can rearrange it later, once you know why.',
      'Aperte Layout automático e o estaleiro posiciona tudo com bom senso. Você rearranja depois, quando souber o porquê.',
    ],
    sConn: [
      'A part that touches nothing does nothing. Parts must connect to the Bridge, edge to edge, or they are dead weight.',
      'Uma peça que não toca em nada não faz nada. As peças precisam se conectar à Ponte, de borda a borda, ou são peso morto.',
    ],
    f1: [
      'Your tank starts low. Fill it at the Port before you fly, always. A dry ship goes nowhere, and I do not tow for free.',
      'Seu tanque começa baixo. Encha-o no Porto antes de voar, sempre. Nave seca não vai a lugar nenhum, e eu não rebocho de graça.',
    ],
    f2: [
      'Then the Missions board. Your first is a test flight: a hop to the pad and back, seconds long. Nothing to fear.',
      'Depois o quadro de Missões. A primeira é um voo de teste: um salto até o pátio e de volta, em segundos. Nada a temer.',
    ],
    f3: [
      'This one. Accept it, then dispatch the ship from the Ship screen. The report waits when she returns.',
      'Esta aqui. Aceite e depois despache a nave na tela da Nave. O relatório espera quando ela voltar.',
    ],
    r1: [
      'Your first report. The Authority reads every one, and so should you. It tells what happened, what it cost, what it paid.',
      'Seu primeiro relatório. A Autoridade lê todos, e você também deveria. Diz o que aconteceu, quanto custou e quanto pagou.',
    ],
    r2: [
      'Flying wears parts down. Worn parts fail at the worst moment. Have them repaired at the Port before the next contract.',
      'Voar desgasta as peças. Peça gasta falha na pior hora. Mande consertar no Porto antes do próximo contrato.',
    ],
    r3: [
      'Between contracts, scavenge or mine; an idle ship earns nothing. The board is yours now, pilot.',
      'Entre contratos, vasculhe ou minere; nave parada não rende nada. O quadro é seu agora, piloto.',
    ],
    l1: [
      'Your tank is low. Refuel before you take another contract. The Authority does not pay for stranded ships.',
      'Seu tanque está baixo. Reabasteça antes de pegar outro contrato. A Autoridade não paga por naves encalhadas.',
    ],
    x1: [
      'A mission lost. It happens to every pilot who flies long enough. The lane does not hold a grudge, and neither do I.',
      'Uma missão perdida. Acontece com todo piloto que voa tempo suficiente. A rota não guarda rancor, e eu também não.',
    ],
    x2: [
      'Repair the ship, refuel, and take something shorter and safer. Learn what went wrong from the report, then go again.',
      'Conserte a nave, reabasteça e pegue algo mais curto e seguro. Aprenda com o relatório o que deu errado e vá de novo.',
    ],
  },
};

const SUN: Voice = {
  name: 'Tomas Verhoeven',
  factionLabel: ['the Sun Traders', 'os Comerciantes do Sol'],
  text: {
    w1: [
      'Welcome to Hedus, friend! Tomas Verhoeven, Guildmaster. Sit, sit. Nobody here answers to an Authority, only to a good deal.',
      'Bem-vindo a Hedus, amigo! Tomas Verhoeven, Mestre da Guilda. Sente, sente. Aqui ninguém responde a uma Autoridade, só a um bom negócio.',
    ],
    w2: [
      'The Sun Traders are free merchants. We know a buyer for everything and a route around everything else.',
      'Os Comerciantes do Sol são livres mercadores. Conhecemos um comprador para tudo e um caminho para contornar o resto.',
    ],
    wLore: [
      'We started as three haulers sharing one fuel depot. Now the guild has hands on half the relays in the system. The secret is simple: be fair, be fast, and never leave a partner stranded.',
      'Começamos como três cargueiros dividindo um depósito de combustível. Hoje a guilda tem mãos em metade dos relés do sistema. O segredo é simples: seja justo, seja rápido e nunca deixe um parceiro encalhado.',
    ],
    w3: [
      'You take jobs from the board: cargo, passengers, escorts, a race when you feel lucky. You get paid, you pay for fuel and repairs, and what is left grows your ship.',
      'Você pega serviços no quadro: carga, passageiros, escoltas, uma corrida quando se sentir com sorte. Recebe, paga combustível e reparos, e o que sobra faz sua nave crescer.',
    ],
    w4: [
      'But first the ship. A good trader knows what is in the hold and what is in the engine room. Come, let me show you.',
      'Mas primeiro a nave. Bom comerciante sabe o que há no porão e na sala de máquinas. Venha, deixe-me mostrar.',
    ],
    s1: [
      'There she is on the grid. The Bridge in the middle runs everything. Lose it and, well, bad day.',
      'Aí está ela na grade. A Ponte no meio comanda tudo. Perca-a e, bom, dia ruim.',
    ],
    s2: [
      'Engine moves her, the tank feeds her, the hold carries the goods, the panel and battery keep the lights on.',
      'O motor move, o tanque alimenta, o porão leva as mercadorias, o painel e a bateria mantêm as luzes acesas.',
    ],
    s3: [
      'Hit Auto layout and the yard does the arranging for you. Tinker later, once you know what you want.',
      'Aperte Layout automático e o estaleiro arruma para você. Mexa depois, quando souber o que quer.',
    ],
    sConn: [
      'Parts have to touch the Bridge, edge to edge, to work. A loose part is dead weight, and weight costs fuel.',
      'As peças precisam tocar a Ponte, de borda a borda, para funcionar. Peça solta é peso morto, e peso custa combustível.',
    ],
    f1: [
      'The tank starts low. Fuel costs coin, but an empty tank costs more. Fill her up at the Port.',
      'O tanque começa baixo. Combustível custa moeda, mas tanque vazio custa mais. Encha no Porto.',
    ],
    f2: [
      'Then to the Missions board. Your first job is a test flight: hop to the pad and back, over in seconds. Easy money, barely.',
      'Depois ao quadro de Missões. Seu primeiro serviço é um voo de teste: um salto até o pátio e de volta, em segundos. Dinheiro fácil, quase nada.',
    ],
    f3: [
      'That one! Accept, dispatch from the Ship screen, and the report comes when she is home.',
      'Essa! Aceite, despache na tela da Nave, e o relatório chega quando ela voltar.',
    ],
    r1: [
      'Your first report! The numbers tell you what to do better. Read them, every trip is a lesson.',
      'Seu primeiro relatório! Os números dizem o que fazer melhor. Leia, cada viagem é uma lição.',
    ],
    r2: [
      'Worn parts break at the worst time. Get them fixed at the Port before the next job.',
      'Peças gastas quebram na pior hora. Mande consertar no Porto antes do próximo serviço.',
    ],
    r3: [
      'Slow day? Scavenge or mine. A ship that sits earns nothing. Now go make some coin, friend!',
      'Dia parado? Vasculhe ou minere. Nave parada não rende nada. Agora vá fazer dinheiro, amigo!',
    ],
    l1: [
      'Tank is nearly dry, friend. Fill up before the next job, or you will be paying for a tow.',
      'O tanque está quase seco, amigo. Encha antes do próximo serviço, ou vai pagar um reboque.',
    ],
    x1: [
      'Lost a run? Everybody does, once. I lost a whole freighter my first year. Still here, still trading.',
      'Perdeu uma viagem? Todo mundo perde, uma vez. Perdi um cargueiro inteiro no meu primeiro ano. Ainda estou aqui, ainda negociando.',
    ],
    x2: [
      'Patch her up, top the tank, take something short and safe. The report shows what went wrong. Then back at it!',
      'Remende, encha o tanque, pegue algo curto e seguro. O relatório mostra o que deu errado. Depois, de volta ao trabalho!',
    ],
  },
};

const EXPLORERS: Voice = {
  name: 'Vik Adeyemi',
  factionLabel: ['the Explorers', 'os Exploradores'],
  text: {
    w1: [
      'So you came to the edge. Good. I am Vik Adeyemi, Elder of Cair Refuge. Out here, a pilot learns fast or not at all. Listen well.',
      'Então você veio à beira. Bom. Sou Vik Adeyemi, Anciã do Refúgio de Cair. Aqui fora, piloto aprende rápido ou não aprende. Ouça bem.',
    ],
    w2: [
      'The Explorers push past the charted belt for ore nobody has priced yet. We do not have maps. We make them.',
      'Os Exploradores avançam além da cinta catalogada atrás de minério que ninguém precificou. Não temos mapas. Nós os fazemos.',
    ],
    wLore: [
      'Cair was a dead relay once. Prospectors lived in it because it was cheap and far from anyone who asked questions. They stayed because nobody else wanted the dark. Now the dark is ours.',
      'Cair foi um relé morto um dia. Prospectores moraram nele porque era barato e longe de quem fazia perguntas. Ficaram porque ninguém mais queria o escuro. Agora o escuro é nosso.',
    ],
    w3: [
      'You take what the board offers: hauling, rescue, mining, the odd race. You get paid, you pay for fuel and mending, and what is left makes a better ship. Out here the ship is everything.',
      'Você pega o que o quadro oferece: carga, resgate, mineração, uma corrida de vez em quando. Recebe, paga combustível e conserto, e o que sobra faz uma nave melhor. Aqui fora a nave é tudo.',
    ],
    w4: [
      'First the ship. Come. I will show you what keeps you alive.',
      'Primeiro a nave. Venha. Vou mostrar o que mantém você vivo.',
    ],
    s1: [
      'There. The Bridge in the middle. Lose it and you lose everything. Guard it.',
      'Aí. A Ponte no meio. Perca-a e perde tudo. Proteja-a.',
    ],
    s2: [
      'Engine, tank, hold, panel, battery. Each does one thing. Together they get you home. Or not.',
      'Motor, tanque, porão, painel, bateria. Cada um faz uma coisa. Juntos levam você para casa. Ou não.',
    ],
    s3: [
      'Auto layout. Press it. The yard will place them. Rough, but it will fly.',
      'Layout automático. Aperte. O estaleiro posiciona. Tosco, mas voa.',
    ],
    sConn: [
      'Every part must touch the Bridge, edge to edge. A dead wire out here is a dead pilot.',
      'Toda peça precisa tocar a Ponte, de borda a borda. Fio morto aqui fora é piloto morto.',
    ],
    f1: [
      'Fuel. Fill the tank at the Port. Out here there are no stations to save you.',
      'Combustível. Encha o tanque no Porto. Aqui fora não há estações para te salvar.',
    ],
    f2: [
      'Then Missions. Your first is a test flight: out to the pad and back, seconds only. See if your ship holds together.',
      'Depois Missões. A primeira é um voo de teste: até o pátio e de volta, só segundos. Veja se sua nave se aguenta.',
    ],
    f3: [
      'That one. Accept it. Dispatch from the Ship screen. Then wait.',
      'Essa. Aceite. Despache na tela da Nave. Depois espere.',
    ],
    r1: [
      'Your first report. It is the map of your mistakes. Read it.',
      'Seu primeiro relatório. É o mapa dos seus erros. Leia.',
    ],
    r2: [
      'Repair what is worn. A part that fails in the dark does not fail politely.',
      'Conserte o que está gasto. Peça que falha no escuro não falha com educação.',
    ],
    r3: [
      'Between jobs, mine or scavenge. The frontier pays those who dig. That is all I can teach from a chair. Go.',
      'Entre serviços, minere ou vasculhe. A fronteira paga quem cava. É tudo que posso ensinar sentada. Vá.',
    ],
    l1: ['Your tank is low. Do not leave like that.', 'Seu tanque está baixo. Não parta assim.'],
    x1: [
      'You lost a run. Everyone out here has. The dark keeps what it takes, but it also teaches.',
      'Você perdeu uma viagem. Todo mundo aqui fora já perdeu. O escuro fica com o que leva, mas também ensina.',
    ],
    x2: [
      'Mend the ship. Fill the tank. Take something short. Read the report to see where it went wrong. Then go again.',
      'Conserte a nave. Encha o tanque. Pegue algo curto. Leia o relatório para ver onde deu errado. Depois vá de novo.',
    ],
  },
};

/** The scenes by mentor id. */
export const MENTOR_SCENES: Readonly<Record<string, readonly SceneData[]>> = {
  luna_mentor_ines: scenes(LUNA),
  sun_mentor_tomas: scenes(SUN),
  explorers_mentor_vik: scenes(EXPLORERS),
};

/**
 * Gives each mentor their scenes while the column is still empty. Admin owns the rows afterwards: a mentor with any
 * scene already is left exactly as it is.
 */
export async function seedDialogueScenes(prisma: PrismaClient): Promise<void> {
  for (const [id, list] of Object.entries(MENTOR_SCENES)) {
    await prisma.$executeRaw`
      UPDATE "QuestGiver" SET "scenes" = ${JSON.stringify(list)}::jsonb
      WHERE "id" = ${id} AND "scenes" = '[]'::jsonb
    `;
  }
}
