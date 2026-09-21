# Rust and Spark — Game Design Document (v0.1)

> **Idle espacial multiplayer assíncrono.** Você monta uma nave a partir de peças, a
> despacha em missões que processam em tempo real, e volta para ler — narrado como um
> RPG de texto — o que aconteceu. Outros jogadores habitam o mesmo mundo persistente.
>
> **Tom:** *The Expanse* (universo logístico e político, sem dobra espacial) +
> *Euro Truck Simulator* (loop de missões: sempre há trabalho, expira e renova, sem punir).
>
> **Estado:** documento de consolidação. Mecânica e jogabilidade da v0.1 travadas.
> Números iniciais validados por simulação (torneio de combate + sweep de 17M de vidas).
> Fonte única de verdade para começar a codar. Documentos-satélite continuam existindo
> com o detalhe fino; este GDD é a visão integrada.

---

## Índice

1. [Visão e pilares](#1-visão-e-pilares)
2. [Fundação: RPG por baixo](#2-fundação-rpg-por-baixo)
3. [Arquitetura multiplayer](#3-arquitetura-multiplayer)
4. [O loop de jogo](#4-o-loop-de-jogo)
5. [A nave e a montagem](#5-a-nave-e-a-montagem)
6. [Catálogo de peças](#6-catálogo-de-peças)
7. [Energia e viabilidade](#7-energia-e-viabilidade)
8. [Combate](#8-combate)
9. [Desgaste e manutenção](#9-desgaste-e-manutenção)
10. [Facções](#10-facções)
11. [Mapa e ambientes](#11-mapa-e-ambientes)
12. [Missões](#12-missões)
13. [Economia](#13-economia)
14. [Derrota, scavenging e recomeço](#14-derrota-scavenging-e-recomeço)
15. [Relatório narrado](#15-relatório-narrado)
16. [Telas do jogo (UX)](#16-telas-do-jogo-ux)
17. [Admin e tuning em runtime](#17-admin-e-tuning-em-runtime)
18. [Modelo de dados](#18-modelo-de-dados)
19. [Números de referência (validados)](#19-números-de-referência-validados)
20. [Escopo de fases](#20-escopo-de-fases)
21. [Pendências e decisões em aberto](#21-pendências-e-decisões-em-aberto)

---

## 1. Visão e pilares

Um **mundo espacial compartilhado**: você **gerencia e escolhe**; o servidor resolve e você lê o resultado. Identidade
(transponders), facção e risco criam conflito emergente entre jogadores que nunca
precisam estar online ao mesmo tempo.

**Pilares de design:**
- **Montagem importa** — a nave é um quebra-cabeça físico de peças, não uma planilha.
- **Espera é gestão** — dano e desgaste transformam a viagem em decisão, não em ócio.
- **Mundo compartilhado** — outros jogadores importam desde o dia 1 (encontros por rota).
- **Comportamento é política** — você pré-configura como a nave age; o servidor executa.
- **RPG por baixo** — tudo é atributo e rolagem contra dificuldade (§2).
- **Naves usadas são o padrão** — ninguém no Cinturão voa 0km. Desgaste é o dreno
  econômico, não uma punição.

---

## 2. Fundação: RPG por baixo

O jogo é, por baixo, um **RPG**. Em vez de simular física exata, a nave é abstraída
numa **ficha de atributos**, e o mundo resolve tudo como testes: rolagem + modificador
vs dificuldade (DC).

**Por quê:**
- **Balanceável** — ajustam-se números de atributo e DC, não fórmulas de física.
- **Legível** — "Mobilidade 7 vs Mira 5 do pirata = boa chance de fugir" se entende;
  fluxo de energia contínuo não.
- **Extensível** — todo sistema novo (fuga, combate, mineração, hackear transponder) é
  "mais um teste vs DC".
- **Determinístico com semente** — casa com o combate por snapshot no servidor e com a
  narração reproduzível (§15).

**Como funciona:**
- A nave é uma **ficha** de atributos agregados das peças: **MOB** (Mobilidade),
  **PDF** (Poder de Fogo), **BLI** (Blindagem), **ESC** (Escudo), **SEN** (Sensores),
  **CRG** (Carga), **HP**.
- As **peças são o "equipamento"** que modifica a ficha.
- Encontros, fuga, combate e missões resolvem-se rolando contra esses atributos.
- Física (delta-v, massa, energia) é *sabor e fonte dos atributos*, não simulação
  literal: massa alta → MOB baixa, e assim por diante.

---

## 3. Arquitetura multiplayer

É um **mundo persistente compartilhado**, não tempo real, onde o backend é a única
fonte da verdade.

**Princípios:**
- Nenhum jogador fala com outro diretamente — todos leem/escrevem no mesmo estado
  persistido. O "multiplayer" emerge do mundo compartilhado.
- **Servidor autoritativo:** toda regra roda no backend, nunca no cliente. O cliente é
  burro — mostra estado e envia ações, nunca decide resultado.
- **Assíncrono:** os dois jogadores não precisam estar online ao mesmo tempo.

**Mundo reativo (v0.1):** nada acontece a menos que um jogador aja. O mundo que
"respira sozinho" (jobs agendados, NPCs patrulhando, mercados flutuando) é fase 2.
Encontros surgem por **sobreposição**: quando dois jogadores ocupam a mesma rota/local,
o servidor cruza os dois na hora de processar.

**Combate por snapshot:** no encontro, o servidor pega o snapshot das duas fichas
naquele instante e resolve como combate de RPG (§8), sem input humano. O defensor não
precisa estar online — a ficha salva no momento do encontro é o que luta. Isso cria a
decisão: **deixe a nave defensável antes de sair**.

---

## 4. O loop de jogo

**Duas camadas de tempo:**

| Camada | Duração | Atividades | Fontes de peça |
|---|---|---|---|
| Curta | rápida | Combate com NPC, scavenging de destroço local | Loot, sucata |
| Longa | média/longa | Viagens, missões, reparo | Recompensa, dinheiro |

Regra de ouro: **só a camada curta pode pedir decisão ativa**; a longa é "configure e
esqueça". A camada de dias (drones, refino noturno) é fase 2.

**Duração calculada por distância, não fixa.** O tempo de uma missão/viagem é calculado
pela distância no mapa, modificado pela MOB da nave, e o sistema classifica em
rápida/média/longa. A mesma rota é média numa nave lenta e rápida numa veloz —
emergente, nunca hard-coded.

**O ciclo, tela a tela** (ver §16 e o fluxograma):

```
Hangar (monta a nave) → Mapa (escolhe destino/missão) → Quadro de missões (aceita)
   → Trânsito (processa em tempo real) → Relatório narrado (lê o que houve)
   → Porto (vende, repara, abastece, scavenging) → volta ao Mapa
```

**Ritmo:** meio pra hard. Erro custa, mas é recuperável. O jogador nunca fica preso
sem nave (§14).

---

## 5. A nave e a montagem

### 5.1 Tipo emergente, não classe fixa
Não há menu de classe. A nave **é** cargueira / transporte / ataque conforme o que você
monta. Os nomes são arquétipos de referência, não travas. Multi-propósito é permitido —
e deliberadamente medíocre (§7).

### 5.2 Montagem por proximidade/adjacência
Não é grade retangular (Galaxy Trucker foi rejeitado). O modelo:
- **Grafo por proximidade** — peças posicionadas no espaço 2D; peças próximas se
  conectam. A nave é um grafo (nós = peças, arestas = conexões).
- **Snap a malha fina, com rotação de peças**, sem sobreposição. Coesão obrigatória até
  a ponte (tudo conectado).
- **v0.1:** posição é **estética + coesão**. O grafo funcional (peça exposta toma dano
  primeiro, etc.) é v0.2 — ver §8 e §21.
- **Modo auto** — o jogador seleciona as peças e o sistema arruma o layout sozinho.
  Acessibilidade para quem não quer posicionar.
- **Casco cosmético** (a "pele" desenhada ao redor) é fase posterior; separado da
  lógica, não bloqueia nada.

### 5.3 Peças obrigatórias (viabilidade condicional à build)
A nave só é despachável se for **viável** (§7). O mínimo depende do que ela monta:
- **Ponte de comando (1, sempre)** — a peça-mãe. Traz embutidos o transponder, O₂ de
  emergência e uma bateria mínima. É a **cápsula de sobrevivência**: se a nave é
  reduzida à ponte, o piloto sobrevive (gancho de resgate). Define o **orçamento de
  estrutura** (quanto a nave pode carregar).
- **Motor (≥1)** — propulsão.
- **Combustível** — tanque + fuel **se motor químico**; motor iônico dispensa tanque
  mas exige geração de energia contínua séria.
- **Suporte de vida** — se houver blocos pressurizados (passageiros).
- **Energia** — reator/bateria conforme o consumo.
- **Estrutura** — soma dos custos ≤ orçamento da ponte.

### 5.4 Parâmetros mostrados na montagem (tempo real)
MOB e classe de velocidade · autonomia · energia gerada vs consumida (verde/vermelho) ·
output de bateria vs consumo ativo · CRG / passageiros · PDF, BLI, ESC, SEN, HP total ·
orçamento de estrutura usado/total · massa total · classe derivada · avisos de
inviabilidade (o que falta pra voar).

### 5.5 Frota: uma nave, arquitetura para várias
Na v0.1 o jogador tem **uma nave**, mas todas as tabelas e relações são projetadas
assumindo várias por jogador — só a interface limita a uma. Barato projetar para N e
limitar a 1; caro o contrário.

---

## 6. Catálogo de peças

Toda peça compartilha um núcleo comum + propriedades da sua classe. **Cinco tiers:**
Comum / Incomum / Rara / Épica / Lendária. Acima de Rara, cada tier adiciona uma
**propriedade comportamental**, não só stats maiores (ex.: motor raro = thrust + chance
de "overdrive" que corta a viagem pela metade gastando o dobro de fuel). O momento é
"achei ALGO", não "+15%".

**Propriedades comuns a toda peça:** id/nome · classe · tier · massa · custo_estrutura ·
preço_¢ · valor_sucata · HP_peça · energia (+gera / −consome) · **condição 0–100%** (§9).

Os três limites que impedem a "nave que faz tudo":
- **custo_estrutura** — orçamento fornecido pela ponte (limite estrutural).
- **massa** — puxa a MOB para baixo (limite dinâmico).
- **energia** — geração ≥ consumo (limite operacional).

> **Escala de referência:** combustível em milhares (tanque inicial ~1.000, cargueiro
> ~3.000); energia em dezenas/centenas; distâncias do mapa em centenas (curta 300,
> média 800, longa 1.800). Valores por-peça abaixo são provisórios do simulador — vivem
> no `PART_CATALOG` editável em runtime (§17), não no código.

### 6.1 Ponte de comando (obrigatória, peça-mãe)
Fornece **+100 de orçamento de estrutura** (é a fonte, não gasta). Traz transponder,
suporte de vida de emergência (O₂ + proteção de radiação mínimos), bateria mínima
embutida (carga 10, output 3). HP alto (30 — a última a cair). Vem grátis no recomeço.
Pontes de classe superior (futuro) dão mais orçamento = naves maiores.

### 6.2 Motores
`MOB = Σpotência ÷ massa_total × 1.6`

- **Químico (líquido)** — pequeno/médio/grande: potência 25/40/70, consome líquido,
  **gera energia** (+2/+4/+7, carrega baterias). Exige tanque.
- **Iônico/elétrico** — potência 12/22, **consome muita energia** (−4/−8), mas
  **dispensa tanque**. Exige bateria + fonte de recarga (painel/reator).
- **Dumping core (endgame)** — potência 200+, consumo ~0. **Se destruído em combate →
  explosão fatal na nave inteira.** "Compra e esquece", com risco catastrófico.

**Progressão de propulsão (emergente):** iônico pequeno + painel (tartaruga inicial) →
nuclear + iônicos maiores (média) → híbrido químico+iônico ("carro híbrido espacial",
melhor dos dois mundos ao custo de peso) → dumping core (endgame).

### 6.3 Tanques, baterias e recarga
- **Tanque** — só com motor químico; fuel carregado adiciona massa (tanque cheio pesa).
- **Bateria** — três números: carga_máx, **output_máx** (tem que ≥ consumo ativo total),
  input_máx (recarga). É o que **absorve os picos de combate** (laser, escudo).
- **Recarga:** painel solar (fraco, grátis, complementar) e gerador nuclear (forte,
  constante — a peça que torna o iônico médio+ viável).

### 6.4 Armas — três pressões de recurso distintas
| Arma | PDF | Recurso | Papel |
|---|---|---|---|
| Balística | +3 | munição (ocupa carga) | barata, munição acaba |
| Laser | +4 | energia (−5) | ignora bônus de escudo; compete com escudo/thrust |
| Míssil leve | +5 (2d6) | estoque | rápido, anti-nave pequena |
| Míssil pesado | +8 (2d6) | estoque | lento, anti-estrutura |

Balística estressa carga, laser estressa energia, míssil estressa espaço. Nenhuma faz
tudo.

### 6.5 Defesa — escudo vs blindagem (papéis distintos)
- **Escudo** (+6, consome −6, regen +2/round com energia) — **toma o dano primeiro**,
  **regenera** com tempo + energia. Papel: sustentação para quem luta muito e tem tempo
  entre combates.
- **Blindagem/casco** (casco +2 BLI/+20 HP; placa militar +5/+40) — **toma antes do
  HP**, **não regenera**. Cara de trocar; **remendar é barato mas piora o teto da
  peça** (decisão: remendo barato e placa pior vs troca cara). Papel: absorção durável
  mas degradável.

### 6.6 Carga, sensores e utilitário
- **Carga:** normal (+5) · refrigerada (+3, −2 energia) · blindada (+2) · pressurizada
  (+2 pax, −2 energia, exige suporte de vida).
- **Sensores/utilitário:** radar (SEN +4, reduz emboscada) · antena (habilita quests de
  contato) · kit de reparo em viagem · equipamento de mineração · coletor de gelo (repõe
  O₂).
- **Chip de supressão de transponder** — NÃO é peça; é consumível caro (cartão/chip) que
  altera nome e assinatura da nave. Uso social completo (blitz, contrabando) é fase 2; na
  v0.1 existe como conceito.

---

## 7. Energia e viabilidade

Distinção descoberta em teste:
- **Energia contínua** (iônicos, radar, refrigeração, suporte de vida) — tem que fechar
  SEMPRE (geração ≥ consumo em cruzeiro).
- **Energia de combate** (laser, escudo) — drena só no combate, coberta pela **bateria**
  (output + carga). É por isso que a bateria existe.

**A nave é despachável se TODOS os balanços fecham:**
1. Ponte presente (1).
2. Propulsão: MOB ≥ 1.
3. Combustível: químico → tanque + fuel; iônico → recarga suficiente.
4. Energia contínua: Σgeração_contínua ≥ Σconsumo_contínuo.
5. Bateria cobre combate: output_máx ≥ dreno de combate; carga ≥ pico.
6. Vida: suporte ativo se houver blocos pressurizados.
7. Estrutura: Σcusto_estrutura ≤ orçamento da ponte.

**Anti-"nave que faz tudo" por MEDIOCRIDADE, não bloqueio (decisão de design validada):**
o canivete-suíço é *montável*, mas fica o mais pesado, MOB no fundo, estrutura quase
estourada, sem margem — pior que qualquer nave especializada no que tenta fazer. O
jogador pode fazer tudo-mal (flexibilidade válida); não pode fazer tudo-bem.

**Presets de energia (fixos na v0.1, editáveis na v0.2):** Cruzeiro (prioriza thrust) ·
Combate (gatilho: encontro hostil → prioriza escudo) · Fuga (gatilho: escudo baixo →
tudo em thrust, sobrecarga: mais rápido, desgaste por tempo). Mesma estrutura de
"perfis com gatilhos" da árvore de encontro (§8).

---

## 8. Combate

**Automático, determinístico, resolvido como RPG e NÃO-mortal.** Rounds onde cada nave
rola ataque (PDF + rolagem) vs defesa da outra (BLI/ESC + rolagem), aplicando dano até
uma vencer ou fugir. Encerra a ~20% de HP = derrota/recuo, **não aniquilação**.
Destruição total é caso raro.

**Consequência por tipo de vencedor:** pirata pilha carga/créditos/peça; facção
desestabiliza (destrói peças, força retorno pela rota).

**Cascata de dano:** escudo → blindagem → casco (HP). O escudo absorve primeiro; o que
passa vai à blindagem; o que sobra atinge o HP. É o que o jogador vê no relatório (§15).

**Comportamento de encontro = política pré-configurada (árvore priorizada).** Como o
combate é assíncrono, o comportamento não é escolhido no momento — o servidor avalia
regras de cima para baixo e para na primeira aplicável. A inteligência emerge da ordem,
não de IA:
1. Outro é da minha facção/aliado? → **Ignora**.
2. Missão manda fugir (entrega/transporte)? → **Tenta fugir**; luta só se encurralado.
3. Missão de caça e o alvo bate? → **Ataca**.
4. Outro é hostil por facção? → aplica **postura** (agressivo ataca; neutro avalia poder
   relativo; defensivo só reage).
5. Nenhuma acima → **Ignora**.

**Postura** (por nave): defensivo / neutro / agressivo. **Contexto da missão** sobrepõe
a postura (entrega foge mesmo se agressiva).

**Fuga (teste de RPG):** sempre tentável. MOB da tua nave vs DC derivada da nave inimiga
(Mira/Velocidade dela) + aleatório. Sucesso escapa sem dano; **falha traz consequência**
(dano, combate em desvantagem). Dá propósito aos motores e torna o cargueiro pesado
vulnerável.

**Velocidade = controle de engajamento, não só esquiva (achado de balanceamento).** Uma
nave muito mais rápida faz hit-and-run: nega o revide em parte dos rounds ("passa,
ataca e sai do alcance"). Esquiva pura não fecha o triângulo; controle de engajamento
fecha.

**Radar e transponder já têm dentes:** radar melhor detecta antes (reage/foge primeiro);
transponder revela facção, suprimi-lo muda como os outros reagem.

**Posicionamento tático (v0.2, não v0.1):** a ideia de peças expostas tomarem dano
primeiro é forte, mas simulada em 3 variações puniu quem investia em blindagem (mais
blindagem = mais rounds = mais chance do núcleo cair). É sistema profundo que exige
rodada de design dedicada. v0.1 mantém combate por atributos (validado); layout é
estético + coesão.

---

## 9. Desgaste e manutenção

**Desgaste é o dreno econômico PRINCIPAL; combustível é tempero (~10%, nunca impede
navegar).** Por que desgaste é melhor dreno: **escala com o sucesso** — nave melhor =
peças mais caras se degradando = manutenção mais cara. Mantém o dinheiro fluindo com
destino mesmo no late-game. Consequência de sabor: **naves usadas viram o padrão**.

**Condição da peça (0–100%):**
- **Performance** = `0,5 + 0,5 × (condição/100)` — degradação suave sempre.
- **Engasgo abaixo de 30%**, exponencial: `chance = ((30 − cond)/30)²`. Quanto pior,
  mais frequente.
- **≤1% de condição: a peça não funciona** (morta até reparar).
- **Peças grátis iniciais vêm usadas (~80%)** — o jogador nasce com sucata, nunca 0km.

**Princípio — hard justo, não arbitrário:** a falha é previsível (o jogador vê a
condição e a chance) e evitável (é só reparar), mas evitar custa. Ninguém falha por azar
puro — falha porque *escolheu* esticar a nave.

**Consequências de falha por tipo de peça:**
| Peça | Ao falhar |
|---|---|
| Motor | queima fuel sem empuxo → missão abortada, volta |
| Bateria | descarrega rápido → escudo/sistemas caem no combate |
| Tanque | vazamento: perde 30–50% do fuel restante |
| Escudo | cai no combate: próximo dano vai direto ao HP |
| Arma | trava: perde metade dos rounds |
| Sensor/radar | cego: emboscada garantida |

**Fontes de desgaste:** `base + ambiental + sobrecarga`. Base ~3% por missão; ambiental
= perigo da zona × 1.2 (§11); sobrecarga = forçar a peça (fuga, puxar mais energia que o
output aguenta), +8–15% num golpe.

**Custo de reparo:** `valor_da_peça × %condição_perdida × fator_local × 0,8`, a **6¢/HP**
(§19). Modulado por local. Às vezes **substituir** a peça (comprar usada mais barata)
sai melhor que reparar.

**A decisão de manutenção é auto-balanceada (validado):** reparar cedo (estável, reparo
pesa) vs reparar tarde (lucrativo, volátil) vs nunca (espiral SUAVE — negligência se
auto-pune sem morte instantânea). Sem estratégia dominante. Erro custa, mas é
recuperável.

---

## 10. Facções

Três jogáveis (neutras entre si na v0.1) + piratas (inimigos de todos, não jogáveis).

| Facção | Território | Cultura | Amarra mecânica |
|---|---|---|---|
| **Luna** | Terra e Lua | mercadores, o interior próspero | missões de comércio/entrega; melhores portos e preços; zona central segura |
| **Sun** | Marte e arredores | militares, duros, tecnológicos | missões de combate/escolta; tecnologia/peças melhores; postura agressiva |
| **Explorers** | estações de mineração da fronteira | "mineradores do espaço", equipamento velho | missões de mineração; mercado de peças usadas; encarnam o sistema de desgaste |
| **Piratas** | — | sem lei | inimigos de TODOS; os NPCs de combate; a ameaça que justifica escolta e armas |

**Matriz de relações (v0.1):** todos neutros entre si, piratas hostis a todos. Mesma
facção não se ataca; neutros se ignoram por padrão (a menos que postura/contexto mude);
piratas sempre hostis.

**Escolha inicial (travado):** o jogador escolhe uma das três ao começar (define porto
inicial, primeiras missões, tom). **Sem troca no MVP.** Todos começam com o mesmo saldo;
a facção dá **desconto de −20% em peças temáticas só no start** (Luna: transporte/carga;
Sun: armas; Explorers: radar/mineração).

**Cores canônicas (UI):** Luna azul `#4a90d9` · Sun amarelo `#e3b341` · Explorers verde
`#3fa66a` · Piratas vermelho `#c23b3b` · Neutro cinza `#5a6273`.

Fase 2+: reputação individual, territórios dinâmicos, peças exclusivas por facção, loop
social de transponder.

---

## 11. Mapa e ambientes

**Um grafo de 12 nós (locais) ligados por rotas (arestas).** Escala v0.1: um sistema
contido, tudo se alcança (estilo Expanse, sem saltos entre sistemas).

**Nós (locais):** nome, tipo, posição (x,y), zona (0=centro seguro … 3=fronteira),
facção dona, campos de estado do mundo vivo (estáticos na v0.1). Tipos: porto/estação
(comprar, vender, reparar, missões) · planeta · campo de sucata/destroços (scavenging) ·
posto de fronteira (serviços caros, mercado negro, missões arriscadas).

**Rotas (arestas):** distância (define tempo e combustível), perigo (0–10, chance de
encontro), ambiente (o que desgasta). Uma rota pode ter 1–2 ambientes.

**Zonas concêntricas:** centro (seguro, sem PvP, serviços baratos, paga pouco) → meio
(perigo moderado, paga melhor) → fronteira (PvP livre, ambientes hostis, melhor loot e
pagamento, serviços caros — o "Cinturão"). O jogador controla o próprio risco escolhendo
até onde vai.

**Controle de facção por zona (v0.1 ESTÁTICO):** cada zona tem % de controle por facção
(semente fixa). Afeta risco de encontro e preço local. Zonas afastadas nascem sob
controle **pirata** = mais risco. [Fase 2: controle dinâmico, empurrado por ações de
missão, muda devagar.]

**Ambientes (4 na v0.1) — cada um estressa um subsistema:**
| Ambiente | Efeito | Mitiga |
|---|---|---|
| Espaço aberto | desgaste base baixo | — |
| Campo de radiação | desgaste em eletrônicos (sensores, ponte, bateria) | blindagem/casco |
| Cinturão de detritos | dano físico ao casco; risco de impacto | blindagem, escudo |
| Poço gravitacional | consome mais combustível | motor forte |

Dá razão para blindagem/escudo além do combate, e torna "que nave para que rota" uma
decisão. Cria alto-risco/alta-recompensa que não depende de PvP.

---

## 12. Missões

**Missão = sequência de PERNAS (legs).** Cada perna é uma viagem entre dois nós que pode
conter um encontro. Motor de resolução ÚNICO: cada perna resolve combustível + ambiente/
desgaste + encontro. O tipo de missão só muda requisitos, pagamento e condições de
sucesso/falha.

Campos: `id · tipo · facção_emissora · origem · destino · pernas[] · requisitos_nave ·
recompensa · prazo/expiração · política_encontro · risco/zona`.

**Os cinco tipos (v0.1):**

| Tipo | Exige na nave | Emissor | Núcleo |
|---|---|---|---|
| **Entrega** | carga (tipo certo) | Luna | 1 perna A→B; carga intacta |
| **Transporte** | cabine pressurizada + suporte de vida | Luna/Sun | passageiros vivos; falha é grave |
| **Escolta** | armas + mobilidade | Sun | nave-NPC tem HP próprio; se cai, falha |
| **Mineração** | equip. mineração + carga | Explorers | contratada (fixo) ou livre (vende por conta) |
| **Resgate** | espaço p/ alvo + velocidade | Explorers/Sun | 2 pernas (ida+volta), prazo apertado |

**Mineração — chance de achado:** `riqueza_ambiente × (1 − raridade_material) ×
eficiência_minerador` por tentativa. Material raro = menos chance, mais valor.

**Resgate — prazo:** aleatório, enviesado folgado→médio.

**Integridade do objeto e prêmio parcial:** toda missão tem um
**objeto** (a carga, o passageiro, a nave escoltada, o resgatado) com **integridade
0–100%**. Dano durante as pernas reduz a integridade. **É o dano ao OBJETO que conta,
não à sua nave** (sua nave é problema seu — custo de reparo depois).
- **Prêmio = base × integridade**, LINEAR entre 100% e 50%.
- **Abaixo de 50% → prêmio ZERO** (objeto danificado demais, entrega recusada). Piso
  duro, sem migalha. Mineração é exceção (o produto é o minério; penalidade é render
  menos).
- **Falha de peça é consequência MECÂNICA pura** (peça trava → aborta/atrasa/expõe o
  objeto), NUNCA embute perda de dinheiro. O pagamento vem só da regra de integridade.

**Requisitos de missão + fluxo de hold:** os requisitos são checados contra a ficha da
nave. Requisito não cumprido → botão "Aceitar" **desabilitado** com o motivo. O jogador
pode pôr a missão **em hold (máx 1)**, ir ao hangar ajustar a nave, voltar e aceitar. O
timer de expiração continua correndo no hold; se expira, "expirada (prazo de início)",
sem punição. **Uma missão ativa por vez na v0.1** (fila encadeada de múltiplas missões é
v2 — pilar próprio).

**Geração (template + contexto, modelo Euro Truck):** quadro de missões **por local**
(cada nó tem sua oferta; viajar muda o que aparece; postos isolados oferecem pouco mas
idealmente ≥1). Templates preenchidos com dados reais do mapa (origem, destino, facção,
carga, prazo). Expiram e renovam, sem punir por perder — oportunidade, não fracasso.

---

## 13. Economia

**Preço não é global — varia por onde você está.** Isso transforma abastecer, reparar e
comprar em decisões geográficas.

`preço_final = preço_base × mod_isolamento × mod_facção × mod_humor_fixo`

- **Isolamento (estático):** 0.9 (hub) → 1.0 (central) → 1.4 (afastado) → 2.0 (fronteira).
- **Facção (estático):** aliado 0.8 · neutro 1.0 · hostil 2.5 (mercado negro ou não vende).
- **Humor fixo do local (estático):** cada local sorteia 0.85–1.15 uma vez, com semente
  fixa. Dá a *sensação* de economia viva sem simular — o jogador percebe "aquela estação
  sempre teve fuel barato". Ilusão honesta e barata.
- **Oferta/procura dinâmica (FASE 2):** exige mundo proativo + massa de jogadores.

Resultado: **~6x de variação** entre o hub mais barato e o posto hostil. Decisão
geográfica real.

**Mercado de peças (v0.1 estático):** todo porto compra e vende. **Venda sempre < compra**
(spread; ~60% na venda). Condição da peça multiplica o valor. Peças usadas (condição
<100%) estão à venda mais baratas. Comprar/vender exige popup de confirmação.

**Sucata vs moeda (distintos):** sucata = qualquer peça extra coletada. Ao achar peça, o
jogador ESCOLHE: levar e instalar (em porto ou nave de manutenção) ou vender por
créditos. Créditos compram peças, reparo, combustível.

**Reparo x abastecimento:** abastecer é **instantâneo** (paga e sai). Reparo **leva
tempo** de jogo: `tempo = pontos_a_reparar × k`, com k = 3 s/ponto no estaleiro grande
(hub) e 8 s/ponto no posto pequeno. Cria a decisão "reparo barato/lento longe ou volto
ao hub".

**Curva de progressão (validada):** a recompensa **escala com o tier** da nave (nave
melhor desbloqueia missões melhores), senão a progressão estagna. Começo rápido (1º
upgrade em ~9 missões → engajamento), degraus crescentes mas alcançáveis, tier 5 como
troféu de longuíssimo prazo. Manutenção constante ao fundo dá peso econômico a cada
missão. Números em §19.

---

## 14. Derrota, scavenging e recomeço

**O jogador nunca fica preso sem nave.** A ponte-cápsula salva o piloto. Duas saídas:
- **Resgate automático** por valor fixo (**800¢**) — o saldo pode ficar **negativo**.
- **Aguardar resgate** de outro jogador/NPC, oferecendo recompensa.

**Saldo negativo:** só missões pagam de volta; enquanto negativo, compras e upgrades são
bloqueados, mas navegar e minerar (com sucata grátis) seguem liberados. Cava e sai
cavando.

**Peças de recomeço = sucata grátis:** raridade comum, qualidade ≤50%, danificadas.
Garante o piso do loop — sempre dá pra remontar um caco viável.

**Scavenging em duas formas:**
- **Ação livre** (solo em campo de detritos): chance BAIXA, risco menor.
- **Missão de scavenging**: mais perigosa (desgaste + ataque + ambiente hostil), drop
  MELHOR.
- O campo define o loot. Peças boas podem estar sob controle pirata (viram missão, exige
  combate).
- Chance de peça útil por tentativa: campo comum (solo) **25%** (quase tudo comum) ·
  campo de missão **55%** (comum/incomum) · campo sob controle pirata **75%** (chance de
  raro). Qualidade sempre danificada (30–70%).

**[v0.2] Limite de inventário de peças:** hoje sem limite (PoC), mas inventário infinito
mata a economia. Opções na mesa: por slots · por massa/volume · guardado na capacidade
da nave vs armazém no porto (aluguel?). O schema já prevê o campo de capacidade para não
quebrar depois. Nota de design: o inventário de peças coletadas é **separado** do
inventário de carga das missões — separação que preserva a imersão, manter.

---

## 15. Relatório narrado

No jogo assíncrono, o jogador não assiste ao combate — **o relatório é a experiência.**
Mas não pode cansar quem lê toda missão. Solução: **três views dos MESMOS eventos
estruturados**, com o resumo como padrão.

- **Resumo (padrão):** 2–3 linhas do que importou + resultado + saldo. O que 90% lê,
  toda vez.
- **Narrativa (opt-in):** capítulos por perna, tom Expanse, número mecânico inline
  discreto ao lado da frase ("o escudo cedeu sob fogo pirata" · −18 HP · escudo −22%),
  eventos grandes com "ver descrição completa". Itens coletados e o dano (cascata
  escudo→blindagem→HP) são links que abrem popup de detalhe.
- **Log (opt-in):** uma linha por evento, cronológica, estilo log de servidor:
  `[perna · categoria] descrição — efeito`. Escaneável, sem cruzar colunas.

**Geração SEM LLM (decisão de arquitetura):** narração por **template/mad-libs
determinístico** — cada tipo de evento tem frases-molde com lacunas ({inimigo}, {peça},
{resultado}); o motor de missão produz os dados, os moldes viram texto. Determinístico e
reproduzível (semente da missão), essencial para o replay do admin. Variedade = escrever
vários moldes por evento (conteúdo, não código). As três views são renderizações dos
mesmos eventos; o `MissionLog` guarda os eventos estruturados, **nunca o texto** (§18).
Reescrever moldes depois não quebra histórico.

---

## 16. Telas do jogo (UX)

Jogo **web** (rotas). O **Mapa é o hub central** de navegação; o Porto é onde você
"entra" num nó. Esboços interativos existem para as telas do loop (montagem, quadro,
mapa, relatório, porto) — ver arquivos `*-esboco.html` e o `fluxograma-navegacao.html`.

**Telas do jogador (v0.1):**
| # | Tela | Papel |
|---|---|---|
| J1 | Quadro de missões | lista por local, expira/renova, 5 tipos, filtro, requisitos + hold |
| J2 | Mapa | 12 nós, rotas, controle de facção, risco, onde há missão/campo |
| J3 | Hangar / Montagem | grafo por adjacência, rotação, diagnóstico de energia |
| J4 | Relatório narrado | pós-missão; 3 views (resumo/narrativa/log) |
| J5 | Porto | UMA tela com abas: mercado · reparo · abastecer · scavenging |
| J6 | Trânsito / Status | missão processando: tempo, perna atual, abortar |
| J7 | Inventário / Sucata | peças coletadas; instalar ou vender |
| J8 | Login / Escolha de facção | onboarding; pega facção (sem troca no MVP) |
| J9 | Perfil / Carteira | saldo (inclusive negativo), facção, histórico |

**Padrões de UI que se repetem:** "card de item" e "painel com abas do porto" cobrem
metade das telas — componentes reaproveitáveis. Mercado usa grade de cards compactos
(raridade + condição visíveis, clique abre ficha completa). Reparo usa slider por peça
(condição atual → 100%) + "reparar tudo". Abastecer tem "encher tanque".

**Tutorial (nota, não construir agora):** onboarding fluido guiando a primeira nave +
primeira missão, **dentro das telas reais** (estado guiado, destaques contextuais), não
tela cheia de texto. Cada tela deve nascer prevendo um "estado guiado".

---

## 17. Admin e tuning em runtime

**Tudo de configuração vive no DB desde o começo. Tuning em runtime, sem
deploy.** Mais esforço agora, mas evita a dívida de migrar config de código para banco
depois. Escopo v0.1: telas A–E. Logs (F) por último, talvez dispensável.

| # | Tela | O que vê / faz |
|---|---|---|
| A | **Dashboard** | jogadores (ativos/novos/retenção), missões e taxa de sucesso, **winrate real vs 55% do sweep**, economia agregada (créditos no mundo, entra vs sai = inflação), distribuição por tier, alertas |
| B | **Economia** | preço praticado por porto, peças mais/menos negociadas, circulação de sucata, **ralo econômico** (onde o dinheiro some — confirma desgaste como dreno) |
| C | **Mundo / Mapa** | 12 nós com controle de facção, tráfego por rota, encontros pirata, geração×consumo de missão por zona |
| D | **Jogadores / Inspetor** | ficha completa, histórico com replay do relatório, linha do tempo; **suporte**: dar/tirar créditos, destravar, tirar do negativo, banir/resetar |
| E | **Tuning (runtime)** | editar sem deploy: números globais (os do sweep), catálogo de peças, mapa (controle, humor de preço, ambientes), tipos de missão + taxa de geração; broadcast, modo manutenção, feature flags |
| F | **Logs / Auditoria** | histórico bruto, replay, caça a exploit — versão simples [F2/talvez dispensável] |

O inspetor de jogador (D) é o que mais salva no dia a dia de um jogo publicado. O tuning
(E) é o mais poderoso e o mais caro — e o motivo de tudo viver no DB.

---

## 18. Modelo de dados

Entidades canônicas (detalhe em `schema-dados-v0.1.md`). Todas as tabelas assumem
**várias naves por jogador** mesmo com o MVP limitando a uma, e **todo número de
balanceamento vive no DB**, não no código.

**Núcleo v0.1:** `PART_CATALOG` (definição estática de peça — editável em runtime) ·
`PART_INSTANCE` (peça que existe, com condição) · `SHIP` · `PLAYER` · `NPC` · `FACTION` ·
`LOCATION` (nó) · `ROUTE` (aresta) · `ENVIRONMENT` · `MISSION_TEMPLATE` ·
`MISSION_INSTANCE` · `DROP_TABLE` (loot configurável) · `MISSION_REPORT`.

**Exigidas pelo tuning/admin:**
- **`GameConfig`** — todo número de balanceamento como par key/value (rec_base,
  preco_reparo, desg_base, drops…), com `updated_by` para auditoria.
- **`PlayerEvent`** — event log por jogador (comprou, reparou, morreu, resgatado,
  upgrade…), fonte de verdade do inspetor e da linha do tempo.
- **`MissionLog`** — eventos ESTRUTURADOS da missão (nunca o texto narrado): `seed`,
  `outcome`, `legs[].events[]` com `{leg, category (combate|ambiente|loot|falha|
  pagamento|transito), type, actors, effects{hp, cond_by_part, credits, loot}, magnitude}`.
  Alimenta as 3 views do relatório e o replay do admin.

**Editáveis em runtime (reforço):** catálogo de peças, nós do mapa, controle de facção
por zona, humor de preço por local, taxa de geração de missão — todos em tabelas, não
hard-coded.

**Ganchos de mundo vivo [fase 2] presentes mas inertes:** campos de estado em `LOCATION`
(necessidades, prosperidade), efeito registrado em missões, carimbo de local+facção em
cada ação. Métricas futuras viram só queries.

---

## 19. Números de referência (validados)

Validados por **torneio de combate** (triângulo pedra-papel-tesoura fechado, todas as
builds em 45–57% de winrate) e **sweep econômico de 17 milhões de vidas** (8.748 configs
× 2.000 vidas). São valores **iniciais**, todos editáveis em runtime; a curva final é
tuning de lançamento.

**Config econômico recomendado (v0.1):**
| Parâmetro | Valor | Notas |
|---|---|---|
| preco_fuel | 3 | tolera faixa 2–4 |
| preco_reparo | 6 ¢/HP | unânime no sweep (100/100 dos melhores) |
| rec_base | 200 | |
| rec_por_tier | 120 | recompensa escala com tier (essencial p/ não estagnar) |
| desg_base | 3–5% por missão | |
| desg_ambiente | 1.2× | |
| manutencao_tier | 100–200 ¢/tier | |
| custos_upgrade | {2:2500, 3:7000, 4:16000, 5:32000} | |
| reparo_limiar | livre (35/45/55 indiferente) | liberdade de estilo do jogador |

**Resultado do config:** falência 0%, combate winrate ~55%, 1º upgrade (tier 2) em ~9
missões, tier 5 em ~120–144 missões, engasgo baixo.

**Dials de combate vencedores:** esquiva=1.5×MOB, bli_teto=4, fura=0.35, esc_regen=2,
kite=0.2, iniciativa=+2 no 1º golpe.

**Deliberadamente generoso (decisão do usuário):** margem alta (~800) e tier5 alcançável
são o "endgame fácil pra testar o conjunto". Os marcos reais serão definidos jogando;
apertar = subir custos de upgrade/manutenção (tuning fino, não redesign).

**Valores testáveis de mecânica** (ancorados na economia acima, ajustar no gameplay):
saldo inicial X = 3.000¢ · desconto de facção −20% no start · resgate-auto 800¢ · drops
de scavenging 25/55/75% · reparo k = 3 (hub) / 8 (posto).

---

## 20. Escopo de fases

**v0.1 (MVP jogável):** fundação RPG · multiplayer assíncrono reativo · montagem por
proximidade + modo auto · peças com tiers e condição · duas camadas de tempo (duração
por distância) · combate automático por snapshot (não-mortal) · facção/postura/contexto
+ fuga · energia = número único + presets fixos · 3 facções + piratas · 12 nós, 4
ambientes · 5 tipos de missão + geração por template (Euro Truck) · integridade do
objeto e prêmio parcial · economia estática em 3 camadas · desgaste como dreno principal
· derrota com recomeço garantido · relatório narrado (3 views, sem LLM) · telas do
jogador J1–J9 · admin A–E com tuning em runtime · ganchos de mundo vivo inertes.

**Fase 2:** mundo proativo (jobs) · mundo vivo (estações com estado dinâmico, ecologia
de piratas, painel de mestre) · controle de facção dinâmico · mercado dinâmico (oferta/
procura) · múltiplas naves · roteamento de energia editável · transponder social (blitz,
SOS, contrabando) · **posicionamento tático no combate** · **fila encadeada de missões**
· **limite de inventário de peças** · mais tipos de missão (exploração, ciência) · editor
de casco cosmético · mapa expandido.

**Fase 3:** territórios e conquista estilo Helldivers · dumping core e geradores
avançados · clãs, eventos globais.

---

## 21. Pendências e decisões em aberto

Todas de **balanceamento ou de v0.2+**, nenhuma de arquitetura da v0.1. Podem esperar a
prototipagem/gameplay.

**Balanceamento (ajustar jogando):**
- Atributos exatos da ficha e contribuição de cada peça (conjunto MOB/PDF/BLI/ESC/SEN/
  CRG/HP definido; pesos finos a calibrar).
- Fórmula de duração por distância e os cortes rápida/média/longa.
- Constantes de pagamento de missão (k_dist, k_perigo, bônus por tipo).
- Valores concretos da chance de mineração.
- Aperto do prazo de resgate; quão mais provável é o encontro na escolta.
- Curva final de progressão / dureza do endgame (hoje deliberadamente fácil).
- Fator de custo_estrutura por tier; curva de massa por unidade de fuel.
- Se o reator nuclear entra na v0.1 ou fica pra fase 2.
- Tempo de sobrevivência da cápsula de emergência (janela de resgate).

**Design de v0.2+ (registrado para não perder):**
- Posicionamento tático no combate (§8) — exige rodada de design dedicada.
- Fila encadeada de missões (§12) — pilar próprio.
- Limite de inventário de peças (§14) — slots vs massa vs armazém.
- Bônus comportamentais de tier alto (hoje cosméticos).

---

## Apêndice — artefatos deste projeto (linkados)

Companion técnico: [**Arquitetura Técnica v0.1**](./arquitetura-tecnica-v0.1.md) — o
*como* implementar (stack, tick, segurança, testes, ordem de construção).

**Documentos de design** (`design/` — o detalhe fino que este GDD resume):
- [escopo-v0.1](./design/escopo-v0.1.md) — visão geral, fundação, todas as decisões em ordem
- [catalogo-pecas-v0.1](./design/catalogo-pecas-v0.1.md) — propriedades e valores por classe de peça
- [desgaste-e-manutencao-v0.1](./design/desgaste-e-manutencao-v0.1.md) — condição, falhas, perigos, reparo
- [economia-v0.1](./design/economia-v0.1.md) — preços por local, curva de progressão, números do sweep
- [faccoes-v0.1](./design/faccoes-v0.1.md) — Luna/Sun/Explorers/Piratas, matriz de relações
- [mapa-e-missoes-v0.1](./design/mapa-e-missoes-v0.1.md) — estrutura do mapa, ambientes, tipos de missão
- [missoes-detalhadas-v0.1](./design/missoes-detalhadas-v0.1.md) — spec dos 5 tipos, integridade do objeto
- [schema-dados-v0.1](./design/schema-dados-v0.1.md) — as 16 entidades canônicas para o banco
- [ux-telas-v0.1](./design/ux-telas-v0.1.md) — inventário de telas, decisões de UX, paleta
- [playtest-mesa-v0.1](./design/playtest-mesa-v0.1.md) — livro de regras jogável de teste de mesa

**Protótipos (`prototypes/` — REFERÊNCIA VISUAL, não código de produção):** HTMLs de PoC
para clicar e validar UX. Dados fake, sem backend, estilo provisório. Viram componentes
React reais consumindo a API (ver arquitetura §6).
- [montagem-esboco](./prototypes/montagem-esboco.html) / [v2](./prototypes/montagem-esboco-v2.html) — hangar/montagem da nave
- [quadro-missoes-esboco](./prototypes/quadro-missoes-esboco.html) — quadro de missões (J1)
- [mapa-esboco](./prototypes/mapa-esboco.html) — mapa do setor (J2)
- [relatorio-narrado-esboco](./prototypes/relatorio-narrado-esboco.html) — relatório, 3 views (J4)
- [porto-esboco](./prototypes/porto-esboco.html) — porto com abas (J5)
- [fluxograma-navegacao](./prototypes/fluxograma-navegacao.html) — mapa de navegação entre telas

**Simulação e balanceamento (`simulation/` — a spec executável dos números):** portar a
lógica para o motor de resolução e validar contra o §19 (ver arquitetura §10, passo 5).
- [torneio-balanceamento](./simulation/torneio-balanceamento.py) — combate build vs build (winrate)
- [simulador-integrado](./simulation/simulador-integrado.py) — vida do jogador, todos os sistemas
- [sweep-rust-and-spark](./simulation/sweep-rust-and-spark.py) — varredura de configs econômicos
- [sweep-resultados.csv](./simulation/sweep-resultados.csv) — resultados do sweep de 17M de vidas
- [simulador-mesa](./simulation/simulador-mesa.py) — protótipo inicial de mesa

---

*Fim do GDD v0.1. Atualizar conforme o gameplay mostrar o que os números de lançamento pedem.*
