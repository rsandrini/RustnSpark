import type { Prisma, PrismaClient } from '@prisma/client';

/**
 * The people behind the missions (docs/design/quest-givers-plan.md). Every faction has one MENTOR (the guide of the
 * onboarding and the author of the first flight, never on an ordinary board) and a few GIVERS with a personality.
 * Admin owns all of it once seeded; this is only the starting content. A giver with a missing pool is fine: the
 * card falls back to the template's own text.
 *
 * Line pool keys (each a list of {en, pt-BR}; `{origin}` `{destination}` `{cargo}` `{reward}` are filled per offer):
 *   offer.<MISSION_TYPE>   the brief on a board card        accepted        said when the mission is taken
 *   report.success|partial|failure   the closing line       first_flight    the mentor's brief for the test flight
 *   tutorial.welcome, tutorial.<step>, tutorial.<step>.done, tutorial.finished, tutorial.first_failure,
 *   tutorial.low_fuel   the mentor, in the Getting started card
 * Personality: {types: {TYPE: weight}, minZone, maxZone, tone}.
 */

interface Line {
  readonly en: string;
  readonly 'pt-BR': string;
}
type Pools = Record<string, readonly Line[]>;

const L = (en: string, ptBR: string): Line => ({ en, 'pt-BR': ptBR });

interface GiverSeed {
  readonly id: string;
  readonly factionId: string;
  readonly role: 'GIVER' | 'MENTOR';
  readonly name: string;
  readonly title: Line;
  readonly personality: {
    readonly types: Readonly<Record<string, number>>;
    readonly minZone: number;
    readonly maxZone: number;
    readonly tone: string;
  };
  readonly lines: Pools;
  readonly locationIds: readonly string[];
  readonly weight: number;
}

/** Tutorial pools for a mentor; the same ten moments for every faction, each in the leader's own voice. */
function tutorial(voice: {
  welcome: Line;
  build: [Line, Line];
  ports: [Line, Line];
  refuel: [Line, Line];
  mission: [Line, Line];
  dispatch: [Line, Line];
  report: [Line, Line];
  repair: [Line, Line];
  work: [Line, Line];
  finished: Line;
  firstFailure: Line;
  lowFuel: Line;
}): Pools {
  const pools: Pools = {
    'tutorial.welcome': [voice.welcome],
    'tutorial.finished': [voice.finished],
    'tutorial.first_failure': [voice.firstFailure],
    'tutorial.low_fuel': [voice.lowFuel],
  };
  for (const step of [
    'build',
    'ports',
    'refuel',
    'mission',
    'dispatch',
    'report',
    'repair',
    'work',
  ] as const) {
    const [nudge, done] = voice[step];
    (pools as Record<string, readonly Line[]>)[`tutorial.${step}`] = [nudge];
    (pools as Record<string, readonly Line[]>)[`tutorial.${step}.done`] = [done];
  }
  return pools;
}

const GIVERS: readonly GiverSeed[] = [
  // ---------------------------------------------------------------- Luna Authority
  {
    id: 'luna_mentor_ines',
    factionId: 'luna',
    role: 'MENTOR',
    name: 'Ines Moura',
    title: L('Dockmaster of Ceres', 'Mestra de Docas de Ceres'),
    personality: { types: { DELIVERY: 1 }, minZone: 0, maxZone: 0, tone: 'formal' },
    weight: 10,
    locationIds: ['ceres'],
    lines: {
      first_flight: [
        L(
          'Every pilot flies the pad before the contracts. Thirty units out, thirty back: a test flight, nothing more. Fuel first, then go.',
          'Todo piloto voa o pátio antes dos contratos. Trinta unidades de ida, trinta de volta: um voo de teste, nada mais. Abasteça primeiro, depois vá.',
        ),
      ],
      ...tutorial({
        welcome: L(
          'Welcome to Ceres, pilot. The Authority keeps the lanes open and the paperwork in order. Follow the list and you will be flying real contracts soon.',
          'Bem-vindo a Ceres, piloto. A Autoridade mantém as rotas abertas e a papelada em ordem. Siga a lista e logo estará voando contratos de verdade.',
        ),
        build: [
          L(
            'A ship is its parts, in the right places. Lay yours out and save it.',
            'Uma nave são suas peças, nos lugares certos. Monte a sua e salve.',
          ),
          L('Good. That hull will hold.', 'Bom. Esse casco aguenta.'),
        ],
        ports: [
          L(
            'Check the connections. A part that touches nothing does nothing.',
            'Confira as conexões. Uma peça que não toca em nada não faz nada.',
          ),
          L('Everything is wired. Neat work.', 'Tudo ligado. Trabalho limpo.'),
        ],
        refuel: [
          L(
            'Fill the tank first, pilot. A dry ship goes nowhere, and I do not tow for free.',
            'Encha o tanque primeiro, piloto. Nave seca não vai a lugar nenhum, e eu não rebocho de graça.',
          ),
          L(
            'Tank full. Now we can talk about flying.',
            'Tanque cheio. Agora podemos falar de voar.',
          ),
        ],
        mission: [
          L(
            'Take your first mission from the board. The short hop to the pad is the right size.',
            'Pegue sua primeira missão no quadro. O salto curto até o pátio é do tamanho certo.',
          ),
          L('Signed and stamped. It is yours.', 'Assinada e carimbada. É sua.'),
        ],
        dispatch: [
          L(
            'Dispatch it. The lane is clear and the clock is running.',
            'Despache. A rota está livre e o relógio está correndo.',
          ),
          L('Away she goes.', 'Lá se vai ela.'),
        ],
        report: [
          L(
            'When the ship returns, read the report. The Authority reads every one.',
            'Quando a nave voltar, leia o relatório. A Autoridade lê todos.',
          ),
          L('Filed. That is how we learn.', 'Arquivado. É assim que se aprende.'),
        ],
        repair: [
          L(
            'Flying wears parts down. Have the worn ones repaired before they fail.',
            'Voar desgasta as peças. Conserte as gastas antes que falhem.',
          ),
          L('Good as new, or near enough.', 'Como nova, ou quase.'),
        ],
        work: [
          L(
            'Between contracts, scavenge the wreckage or mine. Idle ships earn nothing.',
            'Entre contratos, vasculhe destroços ou minere. Nave parada não rende nada.',
          ),
          L('Honest work. Well done.', 'Trabalho honesto. Muito bem.'),
        ],
        finished: L(
          'That is the whole procedure. The board is yours, pilot. Fly safe, and keep your papers in order.',
          'Esse é todo o procedimento. O quadro é seu, piloto. Voe seguro e mantenha seus papéis em ordem.',
        ),
        firstFailure: L(
          'A mission lost is a lesson paid for. Repair, refuel, and take something safer.',
          'Missão perdida é lição paga. Conserte, reabasteça e pegue algo mais seguro.',
        ),
        lowFuel: L(
          'Your tank is low. Refuel before you take another contract.',
          'Seu tanque está baixo. Reabasteça antes de pegar outro contrato.',
        ),
      }),
    },
  },
  {
    id: 'luna_clerk_anselm',
    factionId: 'luna',
    role: 'GIVER',
    name: 'Anselm Rao',
    title: L('Contracts Clerk', 'Escrivão de Contratos'),
    personality: {
      types: { DELIVERY: 30, TRANSPORT: 20, ESCORT: 15, MINING: 10, RESCUE: 15, RACE: 10 },
      minZone: 0,
      maxZone: 3,
      tone: 'formal',
    },
    weight: 10,
    locationIds: [],
    lines: {
      'offer.DELIVERY': [
        L(
          'Cargo from {origin} to {destination}. Sealed, signed, and paying {reward}. Do not open the crate.',
          'Carga de {origin} para {destination}. Lacrada, assinada e pagando {reward}. Não abra a caixa.',
        ),
        L(
          'A routine delivery to {destination}. The Authority pays {reward} on arrival.',
          'Uma entrega de rotina para {destination}. A Autoridade paga {reward} na chegada.',
        ),
      ],
      'offer.TRANSPORT': [
        L(
          'Passengers for {destination}, with papers in order. They expect a quiet ride. Fee: {reward}.',
          'Passageiros para {destination}, com a papelada em ordem. Esperam uma viagem tranquila. Valor: {reward}.',
        ),
      ],
      'offer.ESCORT': [
        L(
          'A freighter bound for {destination} needs a guard on the lane. The Authority pays {reward}.',
          'Um cargueiro rumo a {destination} precisa de escolta na rota. A Autoridade paga {reward}.',
        ),
      ],
      'offer.MINING': [
        L(
          'The Authority needs ore from {destination}. Bring it back and collect {reward}.',
          'A Autoridade precisa de minério de {destination}. Traga e receba {reward}.',
        ),
      ],
      'offer.RESCUE': [
        L(
          'A distress call near {destination}. Go and bring them in; the Authority pays {reward}.',
          'Um chamado de socorro perto de {destination}. Vá e traga-os; a Autoridade paga {reward}.',
        ),
      ],
      'offer.RACE': [
        L(
          'A sanctioned race to {destination}. Fast ships only. First places are paid.',
          'Uma corrida oficial até {destination}. Só naves rápidas. Os primeiros lugares são pagos.',
        ),
      ],
      'report.success': [L('Delivered and filed. Thank you.', 'Entregue e arquivado. Obrigado.')],
      'report.partial': [
        L(
          'Not everything arrived as written. I will note it.',
          'Nem tudo chegou como escrito. Vou anotar.',
        ),
      ],
      'report.failure': [
        L(
          'The contract is void. These things happen.',
          'O contrato está anulado. Essas coisas acontecem.',
        ),
      ],
    },
  },
  {
    id: 'luna_quartermaster_ottilie',
    factionId: 'luna',
    role: 'GIVER',
    name: 'Ottilie Brandt',
    title: L('Quartermaster', 'Intendente'),
    personality: { types: { DELIVERY: 60, TRANSPORT: 40 }, minZone: 0, maxZone: 1, tone: 'gruff' },
    weight: 10,
    locationIds: [],
    lines: {
      'offer.DELIVERY': [
        L(
          'Crates for {destination}. Nothing fancy, just keep them dry and keep them moving. {reward}.',
          'Caixas para {destination}. Nada de mais, só mantenha secas e em movimento. {reward}.',
        ),
      ],
      'offer.TRANSPORT': [
        L(
          'People need to get to {destination} and I have no ship to spare. You do. {reward}.',
          'Gente precisa chegar a {destination} e eu não tenho nave sobrando. Você tem. {reward}.',
        ),
      ],
      'report.success': [L('Good. On time, no fuss.', 'Bom. No prazo, sem alarde.')],
      'report.failure': [L('Next time, plan the fuel.', 'Da próxima vez, planeje o combustível.')],
    },
  },

  // ---------------------------------------------------------------- Sun Traders
  {
    id: 'sun_mentor_tomas',
    factionId: 'sun',
    role: 'MENTOR',
    name: 'Tomas Verhoeven',
    title: L('Guildmaster of Hedus', 'Mestre da Guilda de Hedus'),
    personality: { types: { DELIVERY: 1 }, minZone: 0, maxZone: 0, tone: 'friendly' },
    weight: 10,
    locationIds: ['hedus'],
    lines: {
      first_flight: [
        L(
          'New hands get the pad first: a test flight, a hop out and a hop back, just to feel the ship. Top up the tank and off you go.',
          'Mãos novas começam pelo pátio: um voo de teste, um salto de ida e um de volta, só para sentir a nave. Encha o tanque e vá.',
        ),
      ],
      ...tutorial({
        welcome: L(
          'Welcome to Hedus, friend. No one here answers to an Authority, only to a good deal. Let me show you how it works.',
          'Bem-vindo a Hedus, amigo. Aqui ninguém responde a uma Autoridade, só a um bom negócio. Deixe-me mostrar como funciona.',
        ),
        build: [
          L(
            'First the ship. Put the pieces where they belong and save it.',
            'Primeiro a nave. Ponha as peças onde elas pertencem e salve.',
          ),
          L('Now that looks like a ship!', 'Agora isso parece uma nave!'),
        ],
        ports: [
          L(
            'Check the connections; loose parts are dead weight.',
            'Confira as conexões; peça solta é peso morto.',
          ),
          L('All connected. Pleasure to see it.', 'Tudo conectado. Um prazer ver.'),
        ],
        refuel: [
          L(
            'Fuel costs coin, but empty tanks cost more. Fill it up.',
            'Combustível custa moeda, mas tanque vazio custa mais. Encha.',
          ),
          L('Full tank, full pockets. Almost.', 'Tanque cheio, bolso cheio. Quase.'),
        ],
        mission: [
          L(
            'Pick a job from the board. Start small, we all did.',
            'Escolha um serviço no quadro. Comece pequeno, todos começamos.',
          ),
          L('A fine choice. Off to work.', 'Boa escolha. Ao trabalho.'),
        ],
        dispatch: [
          L('Send her out and watch the clock.', 'Mande-a e vigie o relógio.'),
          L('She flies! Now we wait.', 'Ela voa! Agora esperamos.'),
        ],
        report: [
          L(
            'Read the report when she is back; the numbers tell you what to do better.',
            'Leia o relatório quando ela voltar; os números dizem o que fazer melhor.',
          ),
          L('Good. Every trip is a lesson.', 'Bom. Cada viagem é uma lição.'),
        ],
        repair: [
          L(
            'Worn parts break at the worst time. Get them fixed.',
            'Peça gasta quebra na pior hora. Mande consertar.',
          ),
          L('Fixed up and ready.', 'Consertada e pronta.'),
        ],
        work: [
          L(
            'Slow day? Scavenge or mine. A ship that sits earns nothing.',
            'Dia parado? Vasculhe ou minere. Nave parada não rende nada.',
          ),
          L('Coin in the pocket. That is the spirit.', 'Moeda no bolso. Esse é o espírito.'),
        ],
        finished: L(
          'That is all I know that fits on a list. The rest you learn by trading. Good luck, friend!',
          'Isso é tudo que cabe em uma lista. O resto se aprende negociando. Boa sorte, amigo!',
        ),
        firstFailure: L(
          'Lost a ship run? Everybody does once. Patch up and try again.',
          'Perdeu uma viagem? Todo mundo perde uma vez. Remende e tente de novo.',
        ),
        lowFuel: L(
          'Tank is nearly dry, friend. Fill up before the next job.',
          'O tanque está quase seco, amigo. Encha antes do próximo serviço.',
        ),
      }),
    },
  },
  {
    id: 'sun_fixer_zara',
    factionId: 'sun',
    role: 'GIVER',
    name: 'Zara Quill',
    title: L('Broker', 'Corretora'),
    personality: {
      types: { DELIVERY: 30, TRANSPORT: 20, ESCORT: 15, MINING: 15, RESCUE: 10, RACE: 10 },
      minZone: 0,
      maxZone: 3,
      tone: 'friendly',
    },
    weight: 10,
    locationIds: [],
    lines: {
      'offer.DELIVERY': [
        L(
          'I have a buyer in {destination} and goods in {origin}. You in the middle make {reward}.',
          'Tenho um comprador em {destination} e mercadoria em {origin}. Você no meio ganha {reward}.',
        ),
      ],
      'offer.TRANSPORT': [
        L(
          'Passengers who pay well and ask few questions. {destination}, and {reward} for you.',
          'Passageiros que pagam bem e perguntam pouco. {destination}, e {reward} para você.',
        ),
      ],
      'offer.ESCORT': [
        L(
          'A trader I like is flying to {destination} and wants company. {reward} for keeping them alive.',
          'Um comerciante de quem gosto vai a {destination} e quer companhia. {reward} por mantê-lo vivo.',
        ),
      ],
      'offer.MINING': [
        L(
          'Ore is selling high. Dig some at {destination} and I will pay {reward}.',
          'O minério está em alta. Cave um pouco em {destination} e eu pago {reward}.',
        ),
      ],
      'offer.RESCUE': [
        L(
          'Someone is stuck near {destination} and their family pays {reward}. Be a hero.',
          'Alguém está preso perto de {destination} e a família paga {reward}. Seja um herói.',
        ),
      ],
      'offer.RACE': [
        L(
          'A race to {destination}, bets on the table. Fast ship? Prizes await.',
          'Uma corrida até {destination}, apostas na mesa. Nave rápida? Há prêmios.',
        ),
      ],
      'report.success': [L('Pleasure doing business!', 'Foi um prazer fazer negócio!')],
      'report.partial': [L('Half a deal is still a deal.', 'Meio negócio ainda é negócio.')],
      'report.failure': [
        L('Ouch. Next one is on the house.', 'Ai. O próximo é por conta da casa.'),
      ],
    },
  },
  {
    id: 'sun_marshal_marisol',
    factionId: 'sun',
    role: 'GIVER',
    name: 'Marisol Vega',
    title: L('Race Marshal', 'Marechal de Corridas'),
    personality: { types: { RACE: 60, ESCORT: 40 }, minZone: 0, maxZone: 2, tone: 'friendly' },
    weight: 10,
    locationIds: [],
    lines: {
      'offer.RACE': [
        L(
          'Start line at {origin}, finish at {destination}. Only the fast get paid. Are you fast?',
          'Largada em {origin}, chegada em {destination}. Só os rápidos recebem. Você é rápido?',
        ),
      ],
      'offer.ESCORT': [
        L(
          'Keep the prize convoy to {destination} in one piece. {reward} for a clean run.',
          'Mantenha o comboio do prêmio inteiro até {destination}. {reward} por uma viagem limpa.',
        ),
      ],
      'report.success': [L('That is how you cross a line!', 'É assim que se cruza uma linha!')],
      'report.failure': [L('Better luck next heat.', 'Mais sorte na próxima bateria.')],
    },
  },

  // ---------------------------------------------------------------- Explorers
  {
    id: 'explorers_mentor_vik',
    factionId: 'explorers',
    role: 'MENTOR',
    name: 'Vik Adeyemi',
    title: L('Elder of Cair Refuge', 'Anciã do Refúgio de Cair'),
    personality: { types: { DELIVERY: 1 }, minZone: 0, maxZone: 0, tone: 'gruff' },
    weight: 10,
    locationIds: ['cair'],
    lines: {
      first_flight: [
        L(
          'Before the frontier, the pad. A test flight: a short hop out and back, to see if your ship holds together. Fill the tank. Then go.',
          'Antes da fronteira, o pátio. Um voo de teste: um salto curto de ida e volta, para ver se sua nave se aguenta. Encha o tanque. Depois vá.',
        ),
      ],
      ...tutorial({
        welcome: L(
          'So you came to the edge. Good. Out here a pilot learns fast or not at all. Listen well.',
          'Então você veio à beira. Bom. Aqui fora piloto aprende rápido ou não aprende. Ouça bem.',
        ),
        build: [
          L(
            'Build the ship. Every part where it belongs. Then save it.',
            'Monte a nave. Cada peça onde pertence. Depois salve.',
          ),
          L('Rough, but it will fly.', 'Tosca, mas vai voar.'),
        ],
        ports: [
          L(
            'Check the connections. A dead wire out here is a dead pilot.',
            'Confira as conexões. Fio morto aqui fora é piloto morto.',
          ),
          L('Connected. Good.', 'Conectada. Bom.'),
        ],
        refuel: [
          L(
            'Fuel. Fill the tank. Out here there are no stations to save you.',
            'Combustível. Encha o tanque. Aqui fora não há estações para te salvar.',
          ),
          L('Full. Now you may leave.', 'Cheio. Agora pode partir.'),
        ],
        mission: [
          L('Take a mission. A small one.', 'Pegue uma missão. Uma pequena.'),
          L('Taken. Do not waste it.', 'Pega. Não a desperdice.'),
        ],
        dispatch: [
          L('Send the ship. Watch the fuel.', 'Mande a nave. Vigie o combustível.'),
          L('She is gone. Now wait.', 'Ela partiu. Agora espere.'),
        ],
        report: [
          L(
            'When she is back, read what happened. The report is the map of your mistakes.',
            'Quando ela voltar, leia o que aconteceu. O relatório é o mapa dos seus erros.',
          ),
          L('Read. Learn. Repeat.', 'Leu. Aprendeu. Repita.'),
        ],
        repair: [
          L(
            'Repair what is worn. A part that fails in the dark does not fail politely.',
            'Conserte o que está gasto. Peça que falha no escuro não falha com educação.',
          ),
          L('Mended. For now.', 'Remendada. Por ora.'),
        ],
        work: [
          L(
            'Mine or scavenge. The frontier pays those who dig.',
            'Minere ou vasculhe. A fronteira paga quem cava.',
          ),
          L('You work. You will do.', 'Você trabalha. Vai servir.'),
        ],
        finished: L(
          'That is all I can teach from a chair. The rest is out there. Go.',
          'É tudo que posso ensinar sentada. O resto está lá fora. Vá.',
        ),
        firstFailure: L(
          'You lost a run. Everyone out here has. Mend the ship and go again.',
          'Você perdeu uma viagem. Todo mundo aqui fora já perdeu. Conserte a nave e vá de novo.',
        ),
        lowFuel: L('Tank is low. Do not leave like that.', 'O tanque está baixo. Não parta assim.'),
      }),
    },
  },
  {
    id: 'explorers_scout_pip',
    factionId: 'explorers',
    role: 'GIVER',
    name: 'Pip Okonkwo',
    title: L('Scout', 'Batedor'),
    personality: {
      types: { DELIVERY: 25, TRANSPORT: 15, ESCORT: 15, MINING: 20, RESCUE: 15, RACE: 10 },
      minZone: 0,
      maxZone: 3,
      tone: 'nervous',
    },
    weight: 10,
    locationIds: [],
    lines: {
      'offer.DELIVERY': [
        L(
          'Supplies for {destination}, they are running low. Please hurry. {reward}.',
          'Suprimentos para {destination}, estão acabando. Por favor, depressa. {reward}.',
        ),
      ],
      'offer.TRANSPORT': [
        L(
          'People who need to reach {destination}, quietly. I will pay {reward}.',
          'Gente que precisa chegar a {destination}, em silêncio. Pago {reward}.',
        ),
      ],
      'offer.ESCORT': [
        L(
          'The way to {destination} is not safe. Come along, {reward}.',
          'O caminho para {destination} não é seguro. Vá junto, {reward}.',
        ),
      ],
      'offer.MINING': [
        L(
          'There is ore at {destination}, nobody priced it yet. Bring some and get {reward}.',
          'Há minério em {destination}, ninguém precificou ainda. Traga e receba {reward}.',
        ),
      ],
      'offer.RESCUE': [
        L(
          'Someone is lost near {destination}. Please go. {reward}.',
          'Alguém está perdido perto de {destination}. Por favor, vá. {reward}.',
        ),
      ],
      'offer.RACE': [
        L(
          'A dash to {destination}. Fast ships, no rules. {reward} for the winners.',
          'Uma disparada até {destination}. Naves rápidas, sem regras. {reward} para os vencedores.',
        ),
      ],
      'report.success': [L('You made it! I knew you would.', 'Você conseguiu! Eu sabia.')],
      'report.partial': [L('Not all of it, but thank you.', 'Nem tudo, mas obrigado.')],
      'report.failure': [L('Oh no. Are you all right?', 'Ah, não. Você está bem?')],
    },
  },
  {
    id: 'explorers_prospector_hale',
    factionId: 'explorers',
    role: 'GIVER',
    name: 'Dr. Hale',
    title: L('Prospector', 'Prospectora'),
    personality: { types: { MINING: 70, RESCUE: 30 }, minZone: 0, maxZone: 3, tone: 'gruff' },
    weight: 10,
    locationIds: [],
    lines: {
      'offer.MINING': [
        L(
          'The seam at {destination} is rich and nobody will fetch it. {reward} says you will.',
          'A veia em {destination} é rica e ninguém vai buscar. {reward} diz que você vai.',
        ),
      ],
      'offer.RESCUE': [
        L(
          'My crew is stranded near {destination}. Fetch them, {reward}.',
          'Minha equipe está encalhada perto de {destination}. Busque-os, {reward}.',
        ),
      ],
      'report.success': [L('Good rock. Good work.', 'Boa rocha. Bom trabalho.')],
      'report.failure': [L('The rock does not forgive.', 'A rocha não perdoa.')],
    },
  },
];

export async function seedQuestGivers(prisma: PrismaClient): Promise<void> {
  for (const giver of GIVERS) {
    const data = {
      factionId: giver.factionId,
      role: giver.role,
      active: true,
      name: giver.name,
      title: giver.title as unknown as Prisma.InputJsonValue,
      personality: giver.personality as unknown as Prisma.InputJsonValue,
      lines: giver.lines as unknown as Prisma.InputJsonValue,
      locationIds: [...giver.locationIds],
      weight: giver.weight,
    };
    // Admin owns the rows once seeded: an existing giver is left exactly as it is.
    await prisma.questGiver.upsert({
      where: { id: giver.id },
      update: {},
      create: { id: giver.id, ...data },
    });
  }
}
