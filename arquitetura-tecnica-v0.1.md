# Rust and Spark — Arquitetura Técnica (v0.1)

> Companion do GDD. O GDD diz **o que** construir; este documento diz **como**.
> Decisões de engenharia travadas para a v0.1, prontas para execução no Claude Code.
> Princípio geral: hobby, mas sem gambiarra — seguro e testado desde o primeiro commit.

---

## Índice

1. [Stack e topologia](#1-stack-e-topologia)
2. [O modelo autoritativo (regra de ouro)](#2-o-modelo-autoritativo-regra-de-ouro)
3. [Tempo: tick e processamento de missão](#3-tempo-tick-e-processamento-de-missão)
4. [Estrutura do backend (módulos NestJS)](#4-estrutura-do-backend-módulos-nestjs)
5. [Banco de dados](#5-banco-de-dados)
6. [Frontend (SPA)](#6-frontend-spa)
7. [Segurança](#7-segurança)
8. [Estratégia de testes](#8-estratégia-de-testes)
9. [Docker e ambiente](#9-docker-e-ambiente)
10. [Ordem de construção](#10-ordem-de-construção)
11. [Decisões técnicas em aberto](#11-decisões-técnicas-em-aberto)

---

## 1. Stack e topologia

| Camada | Tecnologia | Porquê |
|---|---|---|
| **Frontend** | React + Vite + TypeScript (SPA) | um só idioma com o back; Vite p/ dev rápido; PoCs HTML convertem direto |
| **Backend** | NestJS (TypeScript) | estrutura opinativa, testável, modular; DI nativa facilita isolar regras |
| **Banco** | PostgreSQL | estado relacional (naves, peças, missões); JSONB onde couber |
| **Fila / tick** | BullMQ sobre Redis | delayed jobs + repeatable jobs = a cara do processamento agendado |
| **Cache / sessão** | Redis | já disponível; cache de leitura e locks |
| **Auth** | JWT próprio (email/senha) | simples, sem dependência externa; OAuth fica p/ depois |
| **Orquestração** | Docker Compose | reusa Postgres e Redis já rodando no servidor local |

RabbitMQ está disponível no servidor mas **não é usado na v0.1** — o forte dele
(roteamento entre serviços) não é o gargalo de um backend único. Reserva para a fase 2
se o sistema quebrar em microserviços.

### Topologia (v0.1)

```
┌─────────────┐     JSON/HTTPS      ┌──────────────────────┐
│  SPA React  │ ◄─────────────────► │   API NestJS         │
│  (browser)  │   só INTENÇÕES      │  (servidor autorit.) │
└─────────────┘                     └───────┬──────────────┘
                                            │
                        ┌───────────────────┼───────────────────┐
                        ▼                   ▼                   ▼
                  ┌───────────┐      ┌─────────────┐     ┌──────────┐
                  │ Postgres  │      │ Redis/BullMQ│     │  Worker  │
                  │ (verdade) │      │ (fila/tick) │◄───►│ (jobs)   │
                  └───────────┘      └─────────────┘     └────┬─────┘
                        ▲                                      │
                        └──────────────────────────────────────┘
                              worker escreve resultados
```

O **Worker** é um processo BullMQ (pode ser o mesmo container do backend em dev, ou
separado). Ele consome a fila e resolve missões/reparos/encontros no horário agendado,
escrevendo o resultado no Postgres. A API e o Worker compartilham o mesmo código de
regras (mesmos módulos de domínio) — a lógica de resolver uma missão é a mesma sendo
chamada por um job, não código duplicado.

---

## 2. O modelo autoritativo (regra de ouro)

**O cliente nunca envia resultados, só intenções.** Esta é a espinha da segurança e da
integridade do jogo. Sem exceção, mesmo custando um round-trip.

- O cliente diz: *"quero aceitar a missão X"*, *"quero despachar para a rota Y"*,
  *"quero comprar a peça Z"*, *"quero reparar a peça W até 80%"*.
- O servidor **valida** (o jogador pode? tem crédito? a nave cumpre o requisito? a
  missão ainda existe?), **resolve** (rola os dados, calcula dano/preço/recompensa) e
  **grava**.
- O cliente **jamais** diz *"ganhei 740 créditos"* ou *"venci o combate"* — ele descobre
  lendo o que o servidor gravou.

Consequências que isto impõe em todo o código:
- **Toda** rolagem de RPG, cálculo de dano, preço, recompensa, chance de drop, desgaste
  é computada **server-side**. O React é uma janela para o estado, nunca fonte de verdade.
- Editar valores no cliente (devtools, requests forjadas) não produz efeito — o servidor
  recalcula tudo a partir do estado persistido.
- Cada endpoint de ação valida **autorização** (é a nave/conta do jogador?) antes de
  qualquer lógica.
- O resultado de qualquer ação é **determinístico com semente** (§GDD 2): a mesma
  entrada + semente produz o mesmo resultado, o que torna tudo testável e o replay do
  admin fiel.

Endpoints são, portanto, **verbos de intenção**, não setters de estado:
`POST /missions/:id/accept`, `POST /ships/:id/dispatch`, `POST /market/buy`,
`POST /ships/:id/repair` — nunca `PUT /player/credits`.

---

## 3. Tempo: tick e processamento de missão

O GDD diz "missão processa em tempo real". A implementação combina **jobs agendados** e
um **tick reativo**, sem o mundo proativo (que é fase 2).

**Princípio:** o tick processa **consequências agendadas de ações de jogadores**, não um
mundo que inventa eventos sozinho. Nada acontece que um jogador não tenha posto em
movimento. Piratas não patrulham, mercados não flutuam na v0.1 — isso é o mundo proativo
da fase 2.

### 3.1 Missão como job agendado

Quando o jogador despacha:
1. `POST /ships/:id/dispatch` — o servidor valida (nave viável? fuel? requisitos?).
2. Calcula a **duração** (distância × MOB → tempo) e a hora de chegada `arrival_at`.
3. Cria a `MISSION_INSTANCE` com status `IN_TRANSIT` e `arrival_at`.
4. Enfileira um **delayed job** no BullMQ: `resolveMission(missionId)` com atraso até
   `arrival_at`.
5. Responde ao cliente: "em trânsito, chega às HH:MM". O cliente mostra o contador.

Quando o job dispara (no horário), o Worker:
1. Carrega o snapshot da nave e o contexto da missão.
2. **Resolve perna a perna** (o motor de resolução determinístico, com `seed`):
   combustível, ambiente/desgaste, encontro (combate/fuga), objeto/integridade.
3. Grava o `MISSION_REPORT` + eventos estruturados no `MissionLog`, atualiza nave
   (dano, condição), carteira (recompensa pela integridade), inventário (loot).
4. Marca a missão como `DONE`. O jogador lê o relatório quando abrir.

**Resiliência:** se o servidor está desligado quando `arrival_at` passa, o job resolve
assim que o Worker sobe (BullMQ persiste no Redis). Adicionalmente, um **tick de
reconciliação** (repeatable job, a cada ~30s) varre missões `IN_TRANSIT` com
`arrival_at` no passado e ainda não resolvidas — rede de segurança contra jobs perdidos.
Isso também torna o sistema robusto a "processar no read": se o jogador abre o jogo e a
missão devia ter terminado, o estado já está resolvido (ou é resolvido na hora pela
reconciliação).

### 3.2 Reparo como job agendado

Mesmo padrão: `POST /ships/:id/repair` valida e cobra, cria job com atraso
`pontos × k` (k=3 hub / k=8 posto), e o Worker marca as peças reparadas ao disparar.
Abastecimento é **instantâneo** (sem job — resolve no request).

### 3.3 Encontro entre jogadores (sobreposição)

Reativo, resolvido na hora de processar a perna. Quando o Worker resolve uma perna de
viagem numa rota:
1. Consulta que outras naves estão/estiveram na mesma rota na mesma janela de tempo
   (índice por `route_id` + intervalo).
2. Se há sobreposição, avalia a **árvore de encontro** (§GDD 8) com o snapshot de ambas
   as fichas.
3. Se resulta em combate, resolve determinístico e grava relatório **para os dois**.

O defensor não precisa estar online — a ficha persistida no momento do encontro é o que
luta. Isto é o "combate por snapshot" do GDD, na prática.

> **Ponto técnico em aberto (§11):** a detecção de sobreposição exata (mesma janela de
> tempo numa rota) precisa de uma decisão de modelagem — registrar "presença em rota"
> como intervalos indexados. Simples com poucos jogadores; a otimizar com escala.

---

## 4. Estrutura do backend (módulos NestJS)

Cada módulo isola um domínio. Regras de jogo puras (combate, economia, desgaste) ficam
em **services sem estado**, testáveis isoladamente, separados dos controllers (HTTP) e
repositories (banco).

```
src/
├── main.ts
├── app.module.ts
├── common/            guards, interceptors, filtros de exceção, validação, RNG semeado
├── auth/              JWT, login/registro, guard de autenticação
├── players/           conta, carteira, perfil, PlayerEvent
├── ships/             nave, montagem, viabilidade, ficha de atributos derivada
├── parts/             PART_CATALOG, PART_INSTANCE, condição/desgaste
├── missions/          templates, geração, instâncias, hold, requisitos
├── resolution/        ⭐ motor determinístico: pernas, combate, fuga, ambiente, objeto
├── economy/           ⭐ preços por local, mercado, recompensa, reparo, scavenging
├── world/             locations, routes, environments, controle de facção
├── factions/          as 3 + piratas, matriz de relações
├── reports/           MissionLog, geração das 3 views (resumo/narrativa/log)
├── jobs/              BullMQ: producers, workers, tick de reconciliação
├── admin/             telas A-E, tuning em runtime, guard de admin
└── config/            GameConfig (números editáveis em runtime), carregamento
```

Os módulos ⭐ (`resolution`, `economy`) são o **núcleo de regras** e os mais testados.
São **determinísticos e sem I/O** — recebem estado, retornam resultado + eventos. Isso os
torna unit-testáveis sem banco e reproduzíveis (a mesma semente → o mesmo resultado), e é
o que permitiu simular o balanceamento em Python (a lógica portada aqui deve bater com os
números do GDD §19).

**RNG semeado (`common`):** um gerador de aleatoriedade com semente por missão, injetado
onde há rolagem. Nunca `Math.random()` direto nas regras — sempre o RNG semeado, para
determinismo e replay.

**GameConfig injetável:** os números de balanceamento (§GDD 19) vivem no banco e são
lidos por um `ConfigService` de domínio (não confundir com o `@nestjs/config` de env).
Nenhuma regra tem número mágico hard-coded — puxa do `GameConfig`. É isso que torna o
tuning em runtime real.

---

## 5. Banco de dados

PostgreSQL. As 16 entidades do GDD §18 / `schema-dados-v0.1.md` viram tabelas. Diretrizes:

- **ORM:** Prisma ou TypeORM. Recomendação **Prisma** — schema declarativo, migrations
  versionadas, tipos gerados (casa com o TS end-to-end). O schema Prisma vira a fonte das
  migrations que o Claude Code aplica.
- **Estado relacional puro** onde há relação (ship → parts, player → ships, mission →
  legs). **JSONB** onde a forma é flexível: `MissionLog.legs[].events[]`,
  `GameConfig.value`, campos de estado inertes do mundo vivo.
- **`GameConfig`** como tabela key/value tipada (`key`, `value` JSONB, `type`,
  `updated_at`, `updated_by`). Semeada por migration com os valores do §19.
- **`PART_INSTANCE`** separada do `PART_CATALOG`: o catálogo é a definição (editável no
  admin), a instância é a peça concreta com condição, dono, nave.
- **Índices críticos:** presença em rota (encontros), missões por `arrival_at` e status
  (tick), `PlayerEvent` por player+tempo (inspetor).
- **Migrations versionadas** no repo, nunca alteração manual de schema.
- **Seed script:** popula catálogo de peças, 12 nós do mapa, 4 ambientes, rotas, 3
  facções, templates de missão e o `GameConfig` — o mundo mínimo jogável.

---

## 6. Frontend (SPA)

React + Vite + TypeScript. O front é uma **janela para o estado** — consome a API JSON,
renderiza, envia intenções. Nenhuma regra de jogo no cliente.

- **Estado do servidor:** TanStack Query (React Query) para buscar/cachear/revalidar. As
  telas são reativas ao estado do servidor; após uma ação (aceitar missão, comprar),
  invalida e refetch.
- **Roteamento:** React Router. As telas do GDD §16 viram rotas (`/hangar`, `/map`,
  `/board`, `/port`, `/report/:id`, `/profile`).
- **Os PoCs (`prototypes/`) são a referência visual**, não código de produção. Cada um
  vira componentes React reais, consumindo a API em vez de dados fake. O design (cores de
  facção, cards, sliders, popups, 3 views do relatório) está validado; é reimplementar em
  componentes.
- **Contadores de tempo:** o cliente exibe o countdown (missão chega em X), mas a
  verdade é o `arrival_at` do servidor. O cliente nunca decide que terminou — pergunta ao
  servidor / refetch quando o tempo passa.
- **Autenticação:** JWT guardado com cuidado (ver §7), enviado no header; rotas
  protegidas no front espelham as guards do back (mas a segurança real é sempre no back).

---

## 7. Segurança

Servidor autoritativo (§2) já elimina a classe de exploits de cliente. Além dele:

**Autenticação & autorização**
- JWT (email/senha) com senha em **Argon2** (ou bcrypt). Nunca senha em texto.
- Access token curto + refresh token; refresh rotacionado.
- **Guard de autorização por recurso:** todo endpoint que age sobre uma nave/missão/conta
  valida que o recurso pertence ao jogador autenticado. Nunca confiar no id vindo do
  cliente sem checar dono.
- **Admin isolado:** as telas A-E exigem role de admin, guard próprio, idealmente rota/
  subdomínio separado. O tuning em runtime (que altera `GameConfig`) é a superfície mais
  sensível — auditar toda escrita (`updated_by`, log).

**Validação de entrada**
- **DTOs validados** (class-validator) em todo endpoint. Nada entra sem schema.
- Rejeitar payloads malformados antes de qualquer lógica. Tipar tudo.

**Superfície de ataque**
- **Rate limiting** (@nestjs/throttler) nos endpoints de ação e no login (anti brute
  force).
- **Helmet** para headers HTTP seguros.
- CORS restrito à origem do SPA.
- Sem segredos no código — variáveis de ambiente (`.env` fora do repo, `.env.example`
  dentro).
- SQL injection coberto pelo ORM (queries parametrizadas), mas revisar qualquer raw query.
- **Idempotência** em ações sensíveis (aceitar missão, comprar) para evitar
  double-submit / replay de request.

**Integridade econômica**
- Toda transação de crédito é atômica (transação de banco). Comprar = validar saldo +
  debitar + entregar item numa transação só; nunca em passos separados que possam falhar
  no meio.
- Locks (Redis ou row-level) onde há corrida possível (ex.: dois requests de compra
  simultâneos do mesmo jogador).

**Segredos & dados**
- Senhas hasheadas, tokens não logados, PII mínima (é um jogo — só o necessário).

---

## 8. Estratégia de testes

Testar desde a v0.1, com foco proporcional ao risco de cada camada.

**Unit (o grosso) — núcleo de regras determinístico**
- `resolution/`: combate, fuga, resolução de perna, integridade do objeto, cascata de
  dano. Com semente fixa, asserções exatas. **Estes testes devem reproduzir os números
  do GDD §19** (winrate ~55%, curva de desgaste, prêmio parcial linear com piso em 50%).
- `economy/`: preço por local (as 3 camadas), spread de mercado, recompensa por
  integridade, custo de reparo, chance de scavenging.
- `ships/`: viabilidade (os 7 balanços), ficha de atributos derivada, MOB.
- `parts/`: performance por condição, engasgo abaixo de 30%, falha por tipo.
- Alvo: cobertura alta nestes módulos — é onde bug vira exploit ou desbalanceamento.

**Integração — API + banco**
- Fluxos de endpoint: aceitar missão (com/sem requisito, hold), despachar, comprar/
  vender, reparar. Testa validação, autorização, atomicidade.
- Banco de teste real (Postgres em container de teste), não mock — pega problemas de
  transação e schema.

**Jobs**
- O Worker resolve uma missão agendada corretamente; o tick de reconciliação pega
  missões órfãs; reparo completa no tempo certo.

**E2E (poucos, críticos)**
- Um "caminho feliz" completo: registrar → montar nave → aceitar missão → despachar →
  (tempo) → ler relatório → vender loot. Garante que as camadas conversam.

**Segurança (testes específicos)**
- Tentar agir sobre nave de outro jogador → 403.
- Tentar comprar sem saldo → rejeitado, sem débito.
- Payload forjado (crédito no corpo) → ignorado, servidor recalcula.
- Rate limit dispara no login.

**CI:** rodar unit + integração a cada commit (Claude Code pode configurar GitHub
Actions ou hook local). Testes verdes como gate de merge.

---

## 9. Docker e ambiente

`docker compose` (sintaxe moderna), reusando Postgres e Redis já rodando no servidor.

Serviços do compose:
- **api** — NestJS (HTTP). Em dev, roda o Worker no mesmo processo; em produção, separável.
- **worker** — processo BullMQ (pode ser o mesmo image da api com comando diferente).
- **web** — o SPA (build estático servido por nginx, ou Vite em dev).
- **postgres** e **redis** — referenciados como serviços externos já existentes, ou
  incluídos no compose para dev isolado (dois profiles: `dev` sobe tudo, `prod` usa os
  externos).

Configuração por `.env` (fora do repo), com `.env.example` versionado. Migrations e seed
rodam na subida (script de entrypoint ou comando manual documentado no README).

---

## 10. Ordem de construção

Sequência sugerida para o Claude Code — cada passo entrega algo testável e desbloqueia o
próximo. Dependências respeitadas.

1. **Fundação** — projeto NestJS, Docker Compose, Postgres+Redis conectados, Prisma
   schema inicial, migrations, `.env`, CI com testes rodando (mesmo que vazios).
2. **Auth & Player** — registro/login JWT, guards, carteira. Testes de auth e autorização.
3. **Config & Seed** — `GameConfig` no banco, `ConfigService` de domínio, seed do mundo
   mínimo (peças, mapa, facções, ambientes, templates). Nada hard-coded.
4. **Parts & Ships** — catálogo, instâncias, montagem, viabilidade (7 balanços), ficha
   derivada. Unit tests batendo com o catálogo do GDD.
5. **Resolution (núcleo)** — motor determinístico: perna, combate, fuga, ambiente,
   desgaste, integridade. **Portar a lógica do simulador Python e validar contra os
   números do §19.** É o coração — mais testado.
6. **Missions** — templates, geração por local, instâncias, requisitos, hold, aceitar.
7. **Jobs & tempo** — BullMQ, despachar → job agendado → Worker resolve → relatório;
   tick de reconciliação. Encontro por sobreposição.
8. **Economy** — preços por local, mercado (compra/venda/spread), reparo (job), scavenging.
9. **Reports** — MissionLog estruturado, geração das 3 views por template (sem LLM).
10. **Frontend** — SPA consumindo a API, telas do §16 a partir dos PoCs, na ordem do
    loop (hangar → mapa → quadro → trânsito → relatório → porto).
11. **Admin** — telas A-E, tuning em runtime, inspetor com replay, guards de admin.
12. **Endurecimento** — rate limiting, helmet, auditoria de tuning, E2E do caminho feliz,
    revisão de segurança.

Marcos jogáveis: após o passo 10 há um **loop jogável ponta a ponta**; o passo 11 dá as
ferramentas de operação; o 12 é o polimento de produção.

---

## 11. Decisões técnicas em aberto

Não bloqueiam começar — resolvíveis no Claude Code durante a implementação.

- **Detecção de sobreposição em rota** (encontros): modelagem exata da "presença em rota"
  como intervalos indexados. Trivial com poucos jogadores; otimizar com escala.
- **Prisma vs TypeORM:** recomendado Prisma, confirmar ao iniciar.
- **Worker no mesmo processo (dev) vs separado (prod):** começar junto, separar quando
  precisar.
- **Granularidade do tick de reconciliação** (~30s?) — ajustar conforme sensação.
- **Storage do JWT no cliente** (cookie httpOnly vs memória + refresh) — cookie httpOnly
  é mais seguro contra XSS; decidir no front.
- **Versionamento da API** (`/v1`) desde já ou depois — barato pôr agora.
- **Observabilidade** (logs estruturados, métricas) — mínimo na v0.1, crescer depois.

---

*Companion do GDD v0.1. Com este documento + o GDD + os satélites + os PoCs, o pacote
está pronto para o Claude Code executar a v0.1.*
