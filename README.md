# Rust and Spark

> **Idle espacial multiplayer assíncrono.** Você monta uma nave a partir de peças, a
> despacha em missões que processam em tempo real, e volta para ler — narrado como um
> RPG de texto — o que aconteceu. Outros jogadores habitam o mesmo mundo persistente.
> Tom: *The Expanse* + *Euro Truck Simulator*.

A v0.1 está **implementada e em playtest ativo**. O design (GDD) e a arquitetura
técnica abaixo seguem como fonte única de verdade — a implementação as segue à risca.
O que resta é ajuste fino: balanceamento (a partir do playtest, ao vivo via Admin →
Tuning, sem deploy) e polimento de UX/copy, registrados e trabalhados em
[docs/superpowers/plans](./docs/superpowers/plans).

## Rodando localmente

Requer Docker e o [Compose plugin](https://docs.docker.com/compose/install/).

```bash
cp .env.example .env
# edite .env: JWT_ACCESS_SECRET e COOKIE_SECRET (32+ chars cada) — gere com:
#   openssl rand -base64 48
docker compose --profile dev up -d --wait --build
```

- Web: http://localhost:8080
- API: http://localhost:3000 (o container `web` também expõe `/v1` via proxy)

Crie o primeiro admin e veja o runbook completo (variáveis de ambiente, deploy,
backup/restore, drill de shutdown) em **[docs/operations.md](./docs/operations.md)**.

Para desenvolver o frontend com hot-reload fora do container, deixe a stack `dev`
rodando (API/worker/Postgres/Redis) e troque o `web` do compose por:

```bash
pnpm install
pnpm dev:web   # Vite em :5173, com /v1 proxiado para a API em :3000
```

### Testes

```bash
pnpm typecheck                 # todos os workspaces
pnpm --filter web test         # Vitest (unit/component, web)
pnpm test:unit                 # Jest (unit, API)
pnpm test:int                  # Jest (integration, API — precisa da stack `test` do compose)
pnpm --filter web e2e          # Playwright, contra a stack `dev` real (não mocks)
```

## Por onde começar

1. **[GDD-rust-and-spark-v0.1.md](./GDD-rust-and-spark-v0.1.md)** — o Game Design
   Document. **O quê** o jogo faz: toda a mecânica, jogabilidade e telas da v0.1, com os
   números validados por simulação. Fonte única de verdade de design. Comece por aqui.
2. **[arquitetura-tecnica-v0.1.md](./arquitetura-tecnica-v0.1.md)** — o companion
   técnico. **Como** foi construído: stack, modelo autoritativo, tick/jobs, segurança,
   testes.

## Estrutura

```
rust-and-spark/
├── README.md                        você está aqui
├── GDD-rust-and-spark-v0.1.md       design completo (o quê)
├── arquitetura-tecnica-v0.1.md      plano técnico (o como)
├── apps/
│   ├── api/                         NestJS: HTTP API + worker (BullMQ) + Prisma (schema/migrations/seed)
│   └── web/                         React + Vite SPA (joga e administra — Admin é uma área da mesma SPA)
├── packages/
│   └── contract/                    schemas zod compartilhados entre API e web (a fonte de verdade dos tipos)
├── docs/
│   ├── operations.md                runbook: topologia, env vars, deploy, backup, primeiro admin
│   └── superpowers/plans/           planos de implementação e de playtest (histórico de trabalho, vivo)
├── design/                          documentos de design (o detalhe fino que o GDD resume)
├── prototypes/                      PoCs de UX em HTML — REFERÊNCIA VISUAL histórica, não produção
└── simulation/                      simuladores Python + resultados (a spec dos números)
```

- **`apps/api`** e **`apps/web`** — a implementação real. Servidor autoritativo: o
  cliente envia intenções, o servidor resolve tudo e é a única fonte de stats/regras
  (nenhum número de jogo é derivado no cliente).
- **`design/`** — os documentos que aprofundam cada sistema (peças, desgaste,
  economia, missões, schema, UX…). O GDD os integra; consulte-os quando precisar do
  valor exato ou do raciocínio por trás de uma decisão.
- **`prototypes/`** — os esboços HTML que validaram a UX antes da implementação real
  (dados fake, sem backend). Já viraram os componentes React de `apps/web`; ficam aqui
  como referência histórica do processo de design, não como algo a manter em sincronia.
- **`simulation/`** — os scripts que balancearam o jogo (torneio de combate, sweep de 17
  milhões de vidas). São a especificação executável dos números: o motor de resolução em
  `apps/api` reproduz estes resultados nos testes de validação (`pnpm test:validation`).

## Stack (resumo)

NestJS (TypeScript) · PostgreSQL · Redis + BullMQ (tick/jobs) · React + Vite (SPA) ·
JWT · Docker Compose. Servidor autoritativo: o cliente envia intenções, o servidor
resolve tudo. Seguro e testado desde o primeiro commit. Detalhes na arquitetura.

## Operação

**[docs/operations.md](./docs/operations.md)** — runbook: topologia, variáveis de ambiente,
deploy, primeiro admin, backup/restore, operação do jogo, drill de shutdown.

## Estado do projeto

- **Design:** ✅ travado (v0.1)
- **Arquitetura técnica:** ✅ implementada
- **Implementação:** ✅ v0.1 completa — API, worker, SPA (jogo + Admin), testes (unit,
  integração, validação econômica, e2e de browser)
- **Balanceamento:** ✅ validado por simulação; ajuste fino contínuo a partir do
  playtest real, aplicado ao vivo via Admin → Tuning (sem deploy)
- **Playtest:** 🔄 em andamento — feedback e progresso registrados em
  [docs/superpowers/plans](./docs/superpowers/plans)

Documento vivo — versionar (v0.2, v0.3…) conforme o gameplay revelar o que os números de
lançamento realmente pedem.
