# Rust and Spark

> **Idle espacial multiplayer assíncrono.** Você monta uma nave a partir de peças, a
> despacha em missões que processam em tempo real, e volta para ler — narrado como um
> RPG de texto — o que aconteceu. Outros jogadores habitam o mesmo mundo persistente.
> Tom: *The Expanse* + *Euro Truck Simulator*.

Este repositório contém o **design e o plano técnico completos da v0.1**, prontos para
implementação. O design está travado; a arquitetura está definida. As pendências que
restam são de balanceamento (ajustar jogando) ou de v0.2+ (adiadas de propósito) —
nenhuma bloqueia começar a codar.

## Por onde começar

1. **[GDD-rust-and-spark-v0.1.md](./GDD-rust-and-spark-v0.1.md)** — o Game Design
   Document. **O quê** construir: toda a mecânica, jogabilidade e telas da v0.1, com os
   números validados por simulação. Fonte única de verdade de design. Comece por aqui.
2. **[arquitetura-tecnica-v0.1.md](./arquitetura-tecnica-v0.1.md)** — o companion
   técnico. **Como** construir: stack, modelo autoritativo, tick/jobs, segurança,
   testes, e uma **ordem de construção de 12 passos** para seguir na implementação.

## Estrutura

```
rust-and-spark/
├── README.md                        você está aqui
├── GDD-rust-and-spark-v0.1.md       design completo (o quê)
├── arquitetura-tecnica-v0.1.md      plano técnico (o como)
├── design/                          documentos de design (o detalhe fino que o GDD resume)
├── prototypes/                      PoCs de UX em HTML — REFERÊNCIA VISUAL, não produção
└── simulation/                      simuladores Python + resultados (a spec dos números)
```

- **`design/`** — os dez documentos que aprofundam cada sistema (peças, desgaste,
  economia, missões, schema, UX…). O GDD os integra; consulte-os quando precisar do
  valor exato ou do raciocínio por trás de uma decisão.
- **`prototypes/`** — esboços HTML interativos das telas, feitos para validar a UX. **São
  referência visual, não código de produção**: dados fake, sem backend, estilo
  provisório. Viram componentes React reais consumindo a API (arquitetura §6). Abra no
  navegador para ver e sentir cada tela.
- **`simulation/`** — os scripts que balancearam o jogo (torneio de combate, sweep de 17
  milhões de vidas). São a **especificação executável dos números**: o motor de
  resolução em código deve reproduzir estes resultados nos testes (arquitetura §10, passo
  5).

## Stack (resumo)

NestJS (TypeScript) · PostgreSQL · Redis + BullMQ (tick/jobs) · React + Vite (SPA) ·
JWT · Docker Compose. Servidor autoritativo: o cliente envia intenções, o servidor
resolve tudo. Seguro e testado desde o primeiro commit. Detalhes na arquitetura.

## Operação

**[docs/operations.md](./docs/operations.md)** — runbook: topologia, variáveis de ambiente,
deploy, primeiro admin, backup/restore, operação do jogo, drill de shutdown.

## Estado do projeto

- **Design:** ✅ travado (v0.1)
- **Balanceamento:** ✅ validado por simulação; números iniciais definidos, ajuste fino
  no gameplay
- **Arquitetura técnica:** ✅ definida
- **Implementação:** 🔜 a começar (seguir a ordem de construção da arquitetura)

Documento vivo — versionar (v0.2, v0.3…) conforme o gameplay revelar o que os números de
lançamento realmente pedem.
