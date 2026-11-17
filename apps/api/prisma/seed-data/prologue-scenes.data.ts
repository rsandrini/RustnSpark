import type { SceneData } from '../../src/dialogue/scenes.js';

/**
 * The words of the new-pilot opening: Bob the friend, Dara the rescuer and Marshal Oren of the harbour office.
 * This is the Admin's own final text, copied out of the dev database (so a fresh install, and prod, start with
 * exactly what was written there). Admin owns the scenes once seeded; this is only the starting content.
 * To refresh it after more Admin edits, export the three guides' `scenes` again and replace the data below.
 */
export const PROLOGUE_SCENES_DATA: Readonly<Record<string, readonly SceneData[]>> = {
  free_mentor_dara: [
    {
      id: 'rescue',
      nodes: [
        {
          id: 'd_rescue_1',
          next: 'd_rescue_2',
          text: {
            en: 'My name is Dara Voss. I’m with the rescue team. We’re bringing you aboard.',
            'pt-BR': 'Meu nome é Dara Voss, Sou do resgate. Estamos puxando você para bordo. ',
          },
          anchor: null,
          choices: [
            {
              next: 'd_rescue_2',
              label: {
                en: 'Bob?',
                'pt-BR': 'Bob?',
              },
              action: 'end',
            },
          ],
          blocking: true,
          position: 'center',
        },
        {
          id: 'd_rescue_2',
          next: null,
          text: {
            en: 'I’m sorry, nothing is left of her ship.',
            'pt-BR': 'Me desculpe, não sobrou nada da nave dela',
          },
          anchor: null,
          choices: [],
          blocking: true,
          position: 'center',
        },
      ],
      order: 33,
      start: 'd_rescue_1',
      title: {
        en: 'Found you',
        'pt-BR': 'Encontramos você',
      },
      trigger: 'prologue_rescue_enter',
    },
    {
      id: 'rescue_done',
      nodes: [
        {
          id: 'd_rescue_done',
          next: null,
          text: {
            en: 'Come aboard when you are ready. ',
            'pt-BR': 'Nós vamos tirar você daqui.',
          },
          anchor: null,
          choices: [],
          blocking: true,
          position: 'center',
        },
      ],
      order: 34,
      start: 'd_rescue_done',
      title: {
        en: 'Come aboard',
        'pt-BR': 'Suba a bordo',
      },
      trigger: 'prologue_rescue_done',
    },
    {
      id: 'final_run_done',
      nodes: [
        {
          id: 'o_final_done',
          next: null,
          text: {
            en: 'Guys, there’s a survivor here!',
            'pt-BR': 'Pessoal, tem um sobrevivente aqui!',
          },
          anchor: null,
          choices: [],
          blocking: true,
          position: 'center',
        },
      ],
      order: 31,
      start: 'o_final_done',
      title: {
        en: 'You made it',
        'pt-BR': 'Você conseguiu',
      },
      trigger: 'prologue_loss_enter',
    },
    {
      id: 'loss_done',
      nodes: [
        {
          id: 'k_loss_done',
          next: 'n2',
          text: {
            en: 'Hey kid, can you breathe? The rescue is here.',
            'pt-BR': 'Hey você, consegue respirar? O resgate chegou.',
          },
          anchor: null,
          choices: [],
          blocking: true,
          position: 'center',
        },
        {
          id: 'n2',
          next: 'n3',
          text: {
            en: 'The pirates hit you both. Your ship is wrecked and drifting, at least we got here quickly.',
            'pt-BR':
              'Os piratas atingiram vocês dois. Sua nave está destruída e à deriva, ainda bem que chegamos a tempo.',
          },
          anchor: null,
          choices: [],
          blocking: true,
          position: 'center',
        },
        {
          id: 'n3',
          next: 'n4',
          text: {
            en: 'Hey! Can you hear me? Are you breathing? — Help over here, team',
            'pt-BR': 'Hey! Você fica comigo. Vamos te tirar dos destroços. Ajuda aqui, equipe.',
          },
          anchor: null,
          choices: [
            {
              next: 'n4',
              label: {
                en: 'Bob?',
                'pt-BR': 'E a Bob?',
              },
              action: 'end',
            },
          ],
          blocking: true,
          position: 'center',
        },
        {
          id: 'n4',
          next: null,
          text: {
            en: "Bob's signal has stopped answering. There is nothing there any remove; I'm sorry.",
            'pt-BR':
              'O sinal da Bob parou de responder. A gente só chegou por causa do sinal dela, mas só encontramos os destroços de sua nave, me desculpe.',
          },
          anchor: null,
          choices: [],
          blocking: true,
          position: 'center',
        },
      ],
      order: 32,
      start: 'k_loss_done',
      title: {
        en: 'Gone',
        'pt-BR': 'Se foi',
      },
      trigger: 'prologue_loss_done',
    },
  ],
  free_mentor_kite: [
    {
      id: 'gift',
      nodes: [
        {
          id: 'k_gift_1',
          next: 'k_gift_2',
          text: {
            en: "Hey. I'm Bob. You look like someone whose ship needs to get somewhere.",
            'pt-BR':
              'Ei, sou a Bob, lembra de mim? Me falaram pra vir te procurar aqui no seu hangar. Parece que você herdou essa lata velha e tá tentando colocar ela pra voar. Talvez eu possa te ajudar.',
          },
          anchor: null,
          choices: [],
          blocking: true,
          dimDelay: 0,
          position: 'center',
          openDelay: 2,
        },
        {
          id: 'k_gift_2',
          next: null,
          text: {
            en: "Here's an old engine. Worn, but honest. Drag it onto your grid and let's hear her hum.",
            'pt-BR':
              'Eu tenho esse motor, ele tá meio velho, mas ainda funciona. Tenta instalar ele aí na tua nave, aí a gente vê se ela ainda consegue voar.',
          },
          anchor: null,
          choices: [],
          blocking: true,
          position: 'center',
        },
      ],
      order: 1,
      start: 'k_gift_1',
      title: {
        en: 'A friend with an engine',
        'pt-BR': 'Um amigo com um motor',
      },
      trigger: 'prologue_gift_enter',
    },
    {
      id: 'gift_done',
      nodes: [
        {
          id: 'k_gift_done',
          next: null,
          text: {
            en: 'There. She hums. You did that with your own hands.',
            'pt-BR': 'Bom, agora você precisa instalar, Vou te dar uma ajuda.',
          },
          anchor: 'part_engine',
          choices: [],
          blocking: true,
          position: 'center',
          openDelay: 2,
        },
      ],
      order: 2,
      start: 'k_gift_done',
      title: {
        en: 'She hums',
        'pt-BR': 'Motor gratis!',
      },
      trigger: 'prologue_gift_done',
    },
    {
      id: 'fit_engine',
      nodes: [
        {
          id: 'k_fit_1',
          next: null,
          text: {
            en: 'Drag the engine onto the grid. The little markers show where it wants to touch the ship.',
            'pt-BR':
              'Arraste o motor para a grade. Os marcadores mostram onde ele encaixar ele nas outras peças da nave.',
          },
          anchor: 'ship_grid',
          choices: [],
          blocking: true,
          position: 'center',
        },
      ],
      order: 3,
      start: 'k_fit_1',
      title: {
        en: 'Fit the engine',
        'pt-BR': 'Encaixe o motor',
      },
      trigger: 'prologue_fit-engine_enter',
    },
    {
      id: 'fit_engine_done',
      nodes: [
        {
          id: 'k_fit_done',
          next: null,
          text: {
            en: 'Fitted. You just made a ship that can fly. Not many people can say that today.',
            'pt-BR':
              'Pronto. Deu certo, e você fez isso com suas próprias mãos, poucos podem dizer que sabem fazer isso hoje em dia. ',
          },
          anchor: null,
          choices: [],
          blocking: true,
          position: 'center',
        },
      ],
      order: 4,
      start: 'k_fit_done',
      title: {
        en: 'Fitted',
        'pt-BR': 'Encaixado',
      },
      trigger: 'prologue_fit-engine_done',
    },
    {
      id: 'race_board',
      nodes: [
        {
          id: 'k_race_board',
          next: null,
          text: {
            en: "I set up a small race. Just you and me. Don't worry about winning yet; just feel the ship.",
            'pt-BR':
              'Vamos tentar correr até o próximo porto. Só eu e você. Não se preocupe em ganhar ainda; só sinta a nave. Mas quem perder paga a cerveja',
          },
          anchor: null,
          choices: [],
          blocking: true,
          position: 'center',
        },
      ],
      order: 5,
      start: 'k_race_board',
      title: {
        en: 'A little race',
        'pt-BR': 'Uma corridinha',
      },
      trigger: 'prologue_race-board_enter',
    },
    {
      id: 'race_board_done',
      nodes: [
        {
          id: 'k_race_board_done',
          next: null,
          text: {
            en: 'Ready? I will be right beside you. Three short legs, then a cold drink.',
            'pt-BR':
              'Pronto? Três trechos curtos, depois um drink gelado. Espero que essa lata velha não exploda!',
          },
          anchor: null,
          choices: [],
          blocking: true,
          position: 'center',
        },
      ],
      order: 6,
      start: 'k_race_board_done',
      title: {
        en: 'Lined up',
        'pt-BR': 'Alistados',
      },
      trigger: 'prologue_race-board_done',
    },
    {
      id: 'race_leg_1',
      nodes: [
        {
          id: 'k_leg_1',
          next: null,
          text: {
            en: 'First leg down. You are keeping up. That is better than most first-timers.',
            'pt-BR':
              'Primeiro trecho, a nave até que funciona em novato! Você está indo muito bem, mas agora chega de te dar vantagem.',
          },
          anchor: null,
          choices: [],
          blocking: true,
          position: 'center',
        },
      ],
      order: 7,
      start: 'k_leg_1',
      title: {
        en: 'First leg',
        'pt-BR': 'Primeiro trecho',
      },
      trigger: 'prologue_race_leg_1',
    },
    {
      id: 'race_leg_2',
      nodes: [
        {
          id: 'k_leg_2',
          next: null,
          text: {
            en: 'Whoa, the engine seems to have sputtered, huh? That’s the trouble with faulty parts. Anyway, I’m in the lead, so try to keep up.',
            'pt-BR':
              'Caraca, o motor parece que esgasgou, né? Esse é o problema de peças danificadas, elas falham bem quando você mais precisa. Bom, eu tô na frente, então tenta me acompanhar.',
          },
          anchor: null,
          choices: [],
          blocking: true,
          position: 'center',
        },
      ],
      order: 8,
      start: 'k_leg_2',
      title: {
        en: 'Halfway',
        'pt-BR': 'Metade',
      },
      trigger: 'prologue_race_leg_2',
    },
    {
      id: 'race_report',
      nodes: [
        {
          id: 'k_race_report',
          next: 'n2',
          text: {
            en: 'Nice one, rookie. You were close. If the engine hadn’t failed, I think you still would’ve lost, but it wouldn’t have been quite as bad, hahaha. Still, since it didn’t explode, that’s great!',
            'pt-BR':
              'Boa novato. Você estava perto. Se o motor não tivesse falhado, acho que você ainda ia perder, mas não ia ser tão feito hahaha. Mas, como não explodiu, tá ótimo.',
          },
          anchor: null,
          choices: [],
          blocking: true,
          position: 'center',
        },
        {
          id: 'n2',
          next: null,
          text: {
            en: "I think you deserve something for the effort. But we'll use it soon.",
            'pt-BR':
              'Acho que você merece algo pelo esforço. Toma esses créditos. Vamos usar eles já já.',
          },
          anchor: null,
          choices: [],
          blocking: false,
          position: 'center',
        },
      ],
      order: 9,
      start: 'k_race_report',
      title: {
        en: 'At the line',
        'pt-BR': 'Na linha',
      },
      trigger: 'prologue_race-report_enter',
    },
    {
      id: 'race_report_done',
      nodes: [
        {
          id: 'k_race_report_done',
          next: null,
          text: {
            en: 'Good money. Refuel, then pick a job. We will earn more together.',
            'pt-BR': 'Reabasteça, depois podemos ver algum servico pra ganhar mais juntos.',
          },
          anchor: null,
          choices: [],
          blocking: true,
          position: 'center',
        },
      ],
      order: 10,
      start: 'k_race_report_done',
      title: {
        en: 'First winnings',
        'pt-BR': 'Primeiros ganhos',
      },
      trigger: 'prologue_race-report_done',
    },
    {
      id: 'stop_port',
      nodes: [
        {
          id: 'k_stop_port',
          next: null,
          text: {
            en: 'First stop. Fill the tank, look at the board, and choose what calls to you.',
            'pt-BR':
              'Coloca o que der no tanque e vai pro quadro de missões. Escolhe uma que você gostar pra gente fazer.',
          },
          anchor: null,
          choices: [],
          blocking: true,
          position: 'center',
        },
      ],
      order: 11,
      start: 'k_stop_port',
      title: {
        en: 'First stop',
        'pt-BR': 'Primeira parada',
      },
      trigger: 'prologue_stop-port_enter',
    },
    {
      id: 'choose_job',
      nodes: [
        {
          id: 'k_choose',
          next: 'n2',
          text: {
            en: 'Passengers or cargo. Different work, same pay. What feels right for your ship?',
            'pt-BR':
              'Passageiros ou carga. Trabalho diferente, mesmo pagamento. O que parece certo para sua nave?',
          },
          anchor: null,
          choices: [],
          blocking: true,
          position: 'center',
        },
        {
          id: 'n2',
          next: null,
          text: {
            en: "We'll probably need to adapt some parts there, but it is simple.",
            'pt-BR':
              'Provavelmente vamos ter que comprar algo a mais pra adaptar aí, mas isso é coisa simples. A gente faz logo depois de você selecionar o tipo de missão.',
          },
          anchor: null,
          choices: [],
          blocking: false,
          position: 'center',
        },
      ],
      order: 13,
      start: 'k_choose',
      title: {
        en: 'What calls to you',
        'pt-BR': 'O que te chama',
      },
      trigger: 'prologue_choose-job_enter',
    },
    {
      id: 'choose_job_done',
      nodes: [
        {
          id: 'k_choose_done',
          next: null,
          text: {
            en: 'Good pick. We will need the right module for it. Buy it here at the port. Passenger cabin for people, cargo hold for crates.',
            'pt-BR': 'Boa escolha. Vamos adicionar as peças que faltam.',
          },
          anchor: null,
          choices: [],
          blocking: true,
          position: 'center',
        },
      ],
      order: 14,
      start: 'k_choose_done',
      title: {
        en: 'That one',
        'pt-BR': 'Essa',
      },
      trigger: 'prologue_choose-job_done',
    },
    {
      id: 'stop_two',
      nodes: [
        {
          id: 'k_stop_two',
          next: null,
          text: {
            en: 'Second job, different place. Same deal: we fly together, earn enough to improve both ships.',
            'pt-BR':
              'Segundo serviço, lugar diferente. Mesmo acordo: voamos juntos, ganhamos o suficiente para melhorar as duas naves.',
          },
          anchor: null,
          choices: [],
          blocking: true,
          position: 'center',
        },
      ],
      order: 25,
      start: 'k_stop_two',
      title: {
        en: 'Second job',
        'pt-BR': 'Segundo serviço',
      },
      trigger: 'prologue_stop-two_enter',
    },
    {
      id: 'final_board',
      nodes: [
        {
          id: 'k_final_board',
          next: 'n2',
          text: {
            en: 'One last run. Dangerous lane, but the pay fixes everything. You in?',
            'pt-BR':
              'Cara, eu encontrei essa missão aqui, mas a rota é perigosa. Os covardes aqui não estão querendo pegar pra fazer',
          },
          anchor: null,
          choices: [
            {
              next: 'n3',
              label: {
                en: 'Dangerous lance?',
                'pt-BR': 'Rota perigosa?',
              },
              action: 'end',
            },
          ],
          blocking: true,
          position: 'center',
        },
        {
          id: 'n2',
          next: null,
          text: {
            en: 'They’re paying really well! We can head over and make some good money right away. Usually, these riskier routes pay well.',
            'pt-BR':
              'Eles estão pagando bem demais! A gente vai e já faz uma grana. Geralmente essas rotas com mais perigos pagam bem.',
          },
          anchor: null,
          choices: [],
          blocking: false,
          position: 'center',
        },
        {
          id: 'n3',
          next: 'n2',
          text: {
            en: 'Yeah, but nothing we can’t handle. It’s probably crawling with pirates and wreckage—I mean, I didn’t get a great look, but trust me; just check out this gear!',
            'pt-BR':
              'Sim, mas nada que a gente não dê conta. Deve tá cheio de piratas e destroços, sei lá, nem vi muito, mas confia, olha o pagamento!',
          },
          anchor: null,
          choices: [],
          blocking: false,
          position: 'center',
        },
      ],
      order: 27,
      start: 'k_final_board',
      title: {
        en: 'One last run',
        'pt-BR': 'Uma última viagem',
      },
      trigger: 'prologue_final-run_enter',
    },
    {
      id: 'final_run',
      nodes: [
        {
          id: 'k_final_run',
          next: null,
          text: {
            en: 'Stay close. Pirates hunt this lane. We fly through together.',
            'pt-BR': 'Fique perto. Piratas caçam nessa rota. Vamos atravessar juntos.',
          },
          anchor: null,
          choices: [],
          blocking: true,
          position: 'center',
        },
      ],
      order: 28,
      start: 'k_final_run',
      title: {
        en: 'Stay close',
        'pt-BR': 'Fique perto',
      },
      trigger: 'prologue_final-run_enter',
    },
    {
      id: 'loss',
      nodes: [
        {
          id: 'k_loss_1',
          next: 'k_loss_2',
          text: {
            en: 'Pirates! They are on us! Break away, I will draw them off!',
            'pt-BR': 'Piratas! Estão em cima de nós! Fuja, eu vou distraí-los!',
          },
          anchor: null,
          choices: [],
          blocking: true,
          position: 'center',
          openDelay: 3,
        },
        {
          id: 'k_loss_2',
          next: 'n3',
          text: {
            en: '...they hit me... my engines are gone... I am losing...',
            'pt-BR': '...me acertaram... meus motores pararam... estou perdendo...',
          },
          anchor: null,
          choices: [],
          blocking: true,
          dimDelay: 0,
          position: 'center',
          openDelay: 2,
        },
        {
          id: 'n3',
          next: 'n4',
          text: {
            en: 'Missiles no, n....     [connection lost]',
            'pt-BR': 'Oh não, perdi os motores, eles vão dispar....          ',
          },
          anchor: null,
          choices: [],
          blocking: true,
          position: 'center',
          openDelay: 3,
        },
        {
          id: 'n4',
          next: null,
          text: {
            en: '... [conn lost]',
            'pt-BR': '...  [conexão perdida]',
          },
          anchor: null,
          choices: [],
          blocking: true,
          position: 'center',
          openDelay: 5,
        },
      ],
      order: 30,
      start: 'k_loss_1',
      title: {
        en: 'Kite!',
        'pt-BR': 'Kite!',
      },
      trigger: 'prologue_final-run_leg_2',
    },
    {
      id: 'upgrade',
      nodes: [
        {
          id: 'k_upgrade_1',
          next: 'k_upgrade_2',
          text: {
            en: 'Listen. The lane ahead has pirates, and they shoot everything that flies. Your hull is too thin for that.',
            'pt-BR':
              'Escute. A rota à frente tem piratas, e eles atiram em tudo que voa. Seu casco é fino demais para isso.',
          },
          anchor: null,
          choices: [],
          blocking: true,
          position: 'center',
        },
        {
          id: 'k_upgrade_2',
          next: null,
          text: {
            en: "But for us to improve something, it needs to be new; there's no point in soldering some boards onto this patched-up mess. Let's fix this first.",
            'pt-BR':
              'Só que pra gente melhor alguma coisa ela precisa estar nova, não adianta soldar umas placas nessa porcaria toda remendada.',
          },
          anchor: null,
          choices: [],
          blocking: true,
          position: 'center',
        },
      ],
      order: 21,
      start: 'k_upgrade_1',
      title: {
        en: 'Pirates ahead',
        'pt-BR': 'Piratas à frente',
      },
      trigger: 'prologue_job-report_enter',
    },
    {
      id: 'upgrade_done',
      nodes: [
        {
          id: 'k_upgrade_done',
          next: null,
          text: {
            en: 'Look at those numbers. She can take a hit now. Let us earn some more.',
            'pt-BR': 'Olhe esses números. Agora ela aguenta um tiro. Vamos ganhar mais um pouco.',
          },
          anchor: null,
          choices: [],
          blocking: true,
          position: 'center',
        },
      ],
      order: 24,
      start: 'k_upgrade_done',
      title: {
        en: 'Sturdier',
        'pt-BR': 'Mais resistente',
      },
      trigger: 'prologue_upgrade_done',
    },
    {
      id: 'fit_module_done',
      nodes: [
        {
          id: 'o_fit_done',
          next: null,
          text: {
            en: 'Your ship is ready for the run. Dispatch when you are steady.',
            'pt-BR': 'Sua nave está pronta para a viagem. Despache quando estiver firme.',
          },
          anchor: null,
          choices: [],
          blocking: true,
          position: 'center',
        },
      ],
      order: 18,
      start: 'o_fit_done',
      title: {
        en: 'Ready for the run',
        'pt-BR': 'Pronto para a viagem',
      },
      trigger: 'prologue_fit-module_done',
    },
    {
      id: 'dispatch_job_done',
      nodes: [
        {
          id: 'o_dispatch_done',
          next: 'n2',
          text: {
            en: 'Once you complete the missions, you’ll be able to see a report of everything that happened, and what you’ve earned, too! But enough being a nerd, let’s move on to the next one.',
            'pt-BR':
              'Quando concluir as missões, você vai poder ver o relatório de tudo o que aconteceu e quando ganhou também! Mas deixa de ser nerd e vamos pra próxima.',
          },
          anchor: null,
          choices: [],
          blocking: true,
          position: 'center',
        },
        {
          id: 'n2',
          next: null,
          text: {
            en: 'One more of these and you’ll have enough to actually make it win a race, haha.',
            'pt-BR':
              'Mais uma dessas e você terá o suficiente para fazê-la realmente ganhar alguma corrida haha.',
          },
          anchor: null,
          choices: [],
          blocking: false,
          position: 'center',
        },
      ],
      order: 19,
      start: 'o_dispatch_done',
      title: {
        en: 'Away',
        'pt-BR': 'Partiu',
      },
      trigger: 'prologue_dispatch-job_done',
    },
    {
      id: 'job_report',
      nodes: [
        {
          id: 'o_job_report',
          next: null,
          text: {
            en: 'Job done. Credits in hand. This is how a ship earns her keep.',
            'pt-BR': 'Serviço feito. Créditos em mãos. É assim que uma nave ganha a vida.',
          },
          anchor: null,
          choices: [],
          blocking: true,
          position: 'center',
        },
      ],
      order: 20,
      start: 'o_job_report',
      title: {
        en: 'Job done',
        'pt-BR': 'Serviço feito',
      },
      trigger: 'prologue_job-report_enter',
    },
    {
      id: 'stop_two_done',
      nodes: [
        {
          id: 'o_stop_two_done',
          next: null,
          text: {
            en: 'Good run. One more to go, then we talk about your future.',
            'pt-BR': 'Boa viagem. Mais uma e aí conversamos sobre seu futuro.',
          },
          anchor: null,
          choices: [],
          blocking: true,
          position: 'center',
        },
      ],
      order: 26,
      start: 'o_stop_two_done',
      title: {
        en: 'Good run',
        'pt-BR': 'Boa viagem',
      },
      trigger: 'prologue_stop-two_done',
    },
    {
      id: 'buy_module_done',
      nodes: [
        {
          id: 'o_buy_done',
          next: null,
          text: {
            en: 'Paid for. Now fit it the same way you fitted the engine.',
            'pt-BR': 'Pago. Agora encaixe do mesmo jeito que encaixou o motor.',
          },
          anchor: null,
          choices: [],
          blocking: true,
          position: 'center',
        },
      ],
      order: 16,
      start: 'o_buy_done',
      title: {
        en: 'Paid for',
        'pt-BR': 'Pago',
      },
      trigger: 'prologue_buy-module_done',
    },
    {
      id: 'fit_module',
      nodes: [
        {
          id: 'k_fit_module',
          next: null,
          text: {
            en: 'Drag, connect, save. The yard does not bite.',
            'pt-BR': 'Arraste, conecte. Depois vamos pras missões',
          },
          anchor: null,
          choices: [],
          blocking: true,
          position: 'center',
        },
      ],
      order: 17,
      start: 'k_fit_module',
      title: {
        en: 'Fit the module',
        'pt-BR': 'Encaixe o módulo',
      },
      trigger: 'prologue_fit-module_enter',
    },
    {
      id: 'repair_done',
      nodes: [
        {
          id: 'k_repair_done',
          next: null,
          text: {
            en: 'Good as new. Now she can take whatever comes. One more thing before the big run: the hull.',
            'pt-BR':
              'Como nova. Agora ela aguenta o que vier. Mais uma coisa antes da corrida grande: o casco.',
          },
          anchor: null,
          choices: [],
          blocking: true,
          position: 'center',
        },
      ],
      order: 23,
      start: 'k_repair_done',
      title: {
        en: 'Good as new',
        'pt-BR': 'Como nova',
      },
      trigger: 'prologue_repair_done',
    },
    {
      id: 'buy_module',
      nodes: [
        {
          id: 'k_buy_module',
          next: null,
          text: {
            en: 'Buy what your job needs. People ride in a cabin, and a cabin only works with life support, so take both. Crates go in the cargo hold.',
            'pt-BR':
              'Compre o que seu serviço precisa. Pessoas viajam numa cabine, e a cabine só funciona com suporte de vida, então leve os dois. Caixas vão no porão de carga.',
          },
          anchor: null,
          choices: [],
          blocking: true,
          position: 'center',
        },
      ],
      order: 15,
      start: 'k_buy_module',
      title: {
        en: 'Buy the module',
        'pt-BR': 'Compre o módulo',
      },
      trigger: 'prologue_buy-module_enter',
    },
    {
      id: 'final_radar',
      nodes: [
        {
          id: 'k_final_radar',
          next: null,
          text: {
            en: 'Wait... I am picking up movement ahead on the radar. Stay sharp.',
            'pt-BR': 'Peraí... estou vendo movimento à frente no radar. Fique atento.',
          },
          anchor: null,
          choices: [],
          blocking: true,
          position: 'center',
        },
      ],
      order: 29,
      start: 'k_final_radar',
      title: {
        en: 'Movement on the radar',
        'pt-BR': 'Movimento no radar',
      },
      trigger: 'prologue_final-run_radar',
    },
  ],
  free_mentor_oren: [
    {
      id: 'stop_port_done',
      nodes: [
        {
          id: 'o_refuel_done',
          next: null,
          text: {
            en: 'Tank full. Good. Now you can reach the board.',
            'pt-BR': 'Abastecido! Siga bem, piloto.',
          },
          anchor: null,
          choices: [],
          blocking: true,
          position: 'center',
          openDelay: 1,
        },
      ],
      order: 12,
      start: 'o_refuel_done',
      title: {
        en: 'Tank full',
        'pt-BR': 'Tanque cheio',
      },
      trigger: 'prologue_stop-port_done',
    },
    {
      id: 'choose_faction',
      nodes: [
        {
          id: 'o_choose_faction',
          next: null,
          text: {
            en: 'The three powers are fighting the pirates. You can fly under one flag. Choose who you fight with.',
            'pt-BR':
              'Os três poderes estão lutando contra os piratas. Você pode voar sob uma bandeira. Escolha com quem lutar.',
          },
          anchor: null,
          choices: [],
          blocking: true,
          position: 'center',
        },
      ],
      order: 35,
      start: 'o_choose_faction',
      title: {
        en: 'Choose who you fight with',
        'pt-BR': 'Escolha com quem lutar',
      },
      trigger: 'prologue_rescue_done',
    },
  ],
} as unknown as Record<string, readonly SceneData[]>;
