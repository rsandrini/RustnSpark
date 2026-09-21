# Jogo Idle Espacial — Escopo v0.1

> Documento de trabalho. Organiza as decisões em núcleo (o que o MVP precisa),
> visão (documentado para fases futuras) e decisões em aberto.

---

## 1. A fantasia central

Não é "mais um idle de nave". É um **ecossistema espacial vivo e compartilhado**:
você monta uma nave a partir de peças, a despacha em missões que processam em tempo
real, e volta para ler o que aconteceu. Outros jogadores habitam o mesmo mundo
persistente. Identidade (transponders), facção e risco criam conflito emergente.
Você **gerencia e escolhe**; o servidor resolve e você assiste.

Pilares:
- **Montagem importa** — a nave é um quebra-cabeça físico, não uma planilha.
- **Espera é gestão** — dano e desgaste transformam a viagem em decisão.
- **Mundo compartilhado** — outros jogadores importam desde o dia 1.
- **Comportamento é política** — você pré-configura como a nave age; o servidor executa.
- **RPG por baixo** — tudo é atributo e rolagem vs dificuldade (ver seção 2).

Referências de tom: **The Expanse** (universo — espaço logístico e político) +
**Euro Truck Simulator** (loop de missões — sempre há trabalho, expira e renova).

---

## 2. Fundação RPG (princípio de arquitetura)

O jogo é, por baixo, um **RPG**: em vez de simular física exata, a nave é abstraída
numa **ficha de atributos** e o mundo resolve tudo como testes (rolagem +
modificador vs dificuldade / DC). Esta é a espinha dorsal que torna o resto
balanceável.

Por que:
- **Balanceável** — ajusta-se números de atributo e DC, não fórmulas de física.
- **Legível** — "Mobilidade 7 vs Mira 5 do pirata = boa chance de fugir" é
  compreensível; fluxo de energia contínuo não é.
- **Extensível** — todo sistema novo (fuga, combate, mineração, hackear
  transponder) é "mais um teste vs DC".
- **Determinístico com semente** — casa com o combate por snapshot no servidor.

Como funciona:
- A nave é uma **ficha**: atributos agregados das peças — ex. Mobilidade, Poder de
  Fogo, Blindagem, Escudo, Sensores, Carga.
- As **peças são o "equipamento"** que modifica a ficha.
- Encontros, fuga, combate e missões resolvem-se rolando contra esses atributos.
- Física (delta-v, massa, energia) é *sabor e fonte dos atributos*, não simulação
  literal. Massa alta → Mobilidade baixa, e assim por diante.

---

## 3. Multiplayer: servidor autoritativo assíncrono (NÚCLEO da v0.1)

Não é multiplayer em tempo real. É um **mundo persistente compartilhado** onde o
backend é a única fonte da verdade.

Princípios:
- Nenhum jogador fala com outro diretamente — todos leem/escrevem no mesmo estado
  persistido. O "multiplayer" emerge do mundo compartilhado.
- **Servidor autoritativo:** toda regra roda no backend, nunca no cliente. Cliente
  é burro — mostra estado e envia ações, nunca decide resultado.
- **Assíncrono:** os dois jogadores não precisam estar online ao mesmo tempo.

### 3.1 Mundo reativo (v0.1)

Nada acontece a menos que um jogador aja. Mundo que "respira sozinho" é fase 2
(proativo, com jobs agendados). Encontros surgem por **sobreposição**: quando dois
jogadores ocupam a mesma rota/local, o servidor cruza os dois.

### 3.2 Combate por snapshot (resolvido como RPG)

Combate é **automático e determinístico**, resolvido pela mecânica RPG (seção 2):
1. Cada nave tem uma ficha de atributos persistida (derivada do layout + dano atual).
2. No encontro, o servidor pega o snapshot das duas fichas naquele instante.
3. Resolve como combate de RPG: rounds onde cada nave rola ataque (Poder de Fogo +
   rolagem) vs defesa da outra (Blindagem/Escudo + rolagem), aplicando dano a blocos
   até uma vencer ou fugir. Sem input humano.
4. Grava resultado: vencedor, blocos danificados, loot.
5. Ambos leem o relatório quando abrirem o jogo.

O defensor não precisa estar online — a ficha salva no momento do encontro é o que
luta. Isso cria decisão estratégica: deixe a nave defensável antes de sair.

### 3.3 Fluxo de encontro (reativo)

1. Jogador despacha do Porto A ao Porto B.
2. Servidor registra: nave X na rota A→B, chega às HH:MM.
3. Outro jogador despacha na mesma rota, ou você chega onde a nave dele está.
4. Ao resolver (abrir o jogo / servidor processar a chegada), detecta a
   sobreposição e avalia: houve encontro? Se sim, resolve pela lógica da seção 7.
5. Relatório para ambos.

---

## 4. As duas camadas de tempo (v0.1)

| Camada | Duração | Atividades | Fontes de peça |
|---|---|---|---|
| Curta | rápida | Combate com NPC, scavenging de destroço local | Loot de combate, sucata |
| Longa | média/longa | Viagens, quests de entrega/transporte, reparo | Recompensa de quest, dinheiro |

Regra de ouro: **só a camada curta pode pedir decisão ativa**. A longa é
"configure e esqueça". Camada de dias (drones, refino noturno) fica para fase 2.

### 4.1 Duração calculada por distância (não fixa)

O tempo de uma missão/viagem é **calculado pela distância no mapa**, modificado
pela nave (mais Mobilidade → mais rápido). O sistema então **classifica**
automaticamente em rápida / média / longa. A mesma rota é média numa nave lenta e
rápida numa veloz — emergente, não hard-coded. Não se definem tempos fixos à mão.

---

## 5. A nave

### 5.1 Tipo emergente, não classe fixa

Não há menu de classe. A nave **é** cargueira / transporte / ataque conforme o que
você monta. Os três nomes são arquétipos de referência, não travas. Multi-propósito
é permitido e esperado.

### 5.2 Montagem: conexão por proximidade

Não é grade retangular (Galaxy Trucker foi rejeitado por ser "encaixar retângulos").
O modelo:

- **Grafo por proximidade** — peças posicionadas no espaço 2D; peças próximas se
  conectam automaticamente. A nave é um grafo (nós = peças, arestas = conexões).
- **Sem âncora estrutural obrigatória** — abstrato, sem espinha/chassi forçado.
- **O grafo alimenta a ficha RPG** — viabilidade e atributos saem de como as peças
  se conectam (ex.: motor sem caminho até uma bateria não recebe energia).
- **Modo auto** — o jogador seleciona as peças e o sistema arruma o layout sozinho.
  Acessibilidade para quem não quer mexer em posicionamento.
- **Editor de casco (cosmético, fase posterior)** — a "pele" desenhada ao redor das
  peças, só estética. Separado da lógica: o grafo define o que a nave faz, o casco é
  a aparência. Não bloqueia nada.

### 5.3 Peças obrigatórias vs opcionais

Nave só é despachável se for **viável** — tem o mínimo:

**Obrigatórias (viabilidade):**
- Ponte de comando (1) — sem ela, nada funciona
- Motor (≥1) — propulsão
- Tanque de combustível (≥1) + combustível carregado
- Suporte de vida / oxigênio (se houver tripulação/passageiros)
- Reator / bateria (≥1) — energia

**Opcionais (definem capacidade e papel):**
- Armas (combate)
- Blocos de carga: normal, refrigerada, blindada, pressurizada
- Antena (comunicação — necessária para quests de contato)
- Radar / sensores (identificação de outras naves; melhor radar = detecta antes)
- Transponder (identidade — ver seção 8)
- Escudos, dissipadores de calor, guindaste de reparo

### 5.4 Peças base gratuitas ("sucata")

O jogador nunca fica preso. Nave destruída → compra peças base (comuns, de sucata)
de graça para remontar uma nave viável. Garante o piso do loop.

### 5.5 Qualidade das peças

Cinco tiers: **Comum / Incomum / Rara / Épica / Lendária**.

Acima de Rara, cada tier adiciona uma **propriedade comportamental**, não só stats
maiores. Ex.: motor raro = thrust + chance de "overdrive" (corta viagem pela metade
gastando dobro de combustível). O momento "achei ALGO", não "+15%".

### 5.6 Dano, desgaste e substituição

- Cada bloco tem HP e **3 estados visuais**: intacto / danificado / crítico.
- Bloco crítico perde eficiência antes de morrer (motor crítico gasta mais
  combustível, arma crítica erra mais).
- Missão gasta HP conforme o tipo (combate desgasta armas/casco; viagem longa
  desgasta motor).
- Peças reparáveis (custa tempo/dinheiro), substituíveis, melhoráveis.

### 5.7 Frota: arquitetura para várias, travada em uma

Na v0.1 o jogador tem **uma nave**. Mas tudo (tabelas, relações, UI de dados) é
projetado assumindo **várias naves por jogador** — só a interface limita a uma.
Barato projetar para N e limitar a 1; caro projetar para 1 e refatorar para N.

---

## 6. Aquisição de peças e economia

| Fonte | O que dá | Papel |
|---|---|---|
| Loja (dinheiro) | Peças novas confiáveis, comuns/incomuns | Piso garantido — nunca trava |
| Quest (recompensa) | Dinheiro + peça específica | Progressão dirigida |
| Scavenging (destroços) | Peças usadas aleatórias + sucata | Aposta de baixo risco |
| Loot de NPC (combate) | Peças raras+, chance maior de tier alto | Aposta de alto risco |

**Loja garante o piso, combate oferece o teto.**

Anti-inflação de inventário:
- Peça comum lootada vira **sucata** (moeda de material) ao desmontar — sempre vale.
- Peça lootada vem com desgaste; inferior a comprada nova. Dinheiro = confiabilidade,
  loot = aposta.

### 6.1 Drops configuráveis (requisito do dev)

Tabelas de drop (% por tier/fonte/local) **editáveis sem esforço** — dados, não
código (seção 9).

### 6.2 Recursos do jogador

Dinheiro (créditos), inventário de peças, combustível, sucata, a(s) nave(s).

---

## 7. Facção, postura e comportamento de encontro (NÚCLEO da v0.1)

Como o combate é automático e assíncrono, o comportamento não é escolhido no
momento — é uma **política pré-configurada que o servidor executa**.

Três entradas produzem a ação:

- **Facção** — a quem você pertence (3 para começar, com tempero Expanse: interior
  corporativo / militar / fronteira marginalizada). Matriz de relações padrão
  aliado / neutro / inimigo. Mesma facção não se ataca; rivais são hostis por padrão.
- **Postura** — configurada por nave: defensivo / neutro / agressivo.
- **Contexto da missão** — sobrepõe a postura. Entrega foge mesmo se agressiva;
  caça ataca mesmo se defensiva. Cada tipo de missão carrega sua política de encontro.

### 7.1 Motor de resolução (árvore priorizada)

O servidor avalia regras de cima para baixo e para na primeira aplicável. A
inteligência emerge da ordem, não de IA. Ordem exemplo (configurável):

1. Outro é da minha facção / aliado? → **Ignora**.
2. Missão manda fugir de combate (entrega/transporte)? → **Tenta fugir**; luta só
   se encurralado.
3. Missão de caça e o alvo bate com o objetivo? → **Ataca**.
4. Outro é hostil por facção? → aplica **postura** (agressivo ataca; neutro avalia
   poder relativo; defensivo só reage).
5. Nenhuma acima → **Ignora**.

### 7.2 Regra de fuga (teste de RPG)

Fuga é **sempre possível de tentar**. Resolve-se como teste de RPG: Mobilidade da
tua nave vs uma DC derivada da nave inimiga (Mira/Velocidade dela) + fator
aleatório. Sucesso escapa sem dano; **falha traz consequência** (dano, entra em
combate em desvantagem). A DC é analisada com base nas naves envolvidas. Dá
propósito aos motores e torna o cargueiro pesado genuinamente vulnerável.

### 7.3 Radar e transponder já têm dentes na v0.1

- Radar melhor → detecta o outro antes, reage/foge primeiro.
- Transponder revela facção; suprimi-lo deixa "não identificado", mudando como os
  outros reagem. Início do sistema de identidade.

---

## 8. Sistemas de recurso e energia (NÚCLEO da v0.1, exposto em estágios)

A nave tem um sistema de energia que flui de fontes para consumidores. Na v0.1 ele
é simplificado (número único + presets fixos); a versão configurável vem depois.

### 8.1 Fontes de energia (combustível em 3 categorias)

Hierarquia de progressão:
- **(a) Combustível líquido** — reabastecido em portos, finito, barato. Motores
  químicos. O básico. **(v0.1)**
- **(b) Energético (baterias)** — recarregado por painel solar (lento, grátis) ou
  geradores (nuclear/hidrogênio). Alimenta lasers, escudos, sensores. **(v0.1)**
- **(c) Dumping core (estilo Expanse)** — caro, raro, praticamente infinito.
  Endgame. **(fase futura)**

Categorias **não são intercambiáveis**: motor químico quer líquido, laser quer
bateria. A nave carrega múltiplos tipos conforme o que monta — origem do
balanceamento emergente (mais sistemas elétricos → mais bateria → mais massa → menos
Mobilidade → mais líquido...).

### 8.2 Os três recursos de sobrevivência (pesos diferentes)

- **Combustível/energia** — o recurso *tenso*, gera decisão constante.
- **Oxigênio** — deliberadamente *secundário*. Reabastecido fácil/quase grátis
  (coleta de gelo). Existe pela fantasia e por emergências ocasionais, não para
  micromanagement.
- **Defesas (escudos)** — consomem energia ativa, competindo com thrust e armas.

### 8.3 Roteamento — presets fixos na v0.1, editável depois

Perfis de energia que a simulação alterna conforme gatilhos. **Na v0.1 são presets
fixos** (o jogador não edita):
- **Cruzeiro** (padrão): prioriza thrust.
- **Combate** (gatilho: encontro hostil): prioriza escudo.
- **Fuga** (gatilho: escudo baixo): tudo em thrust, sobrecarga (mais rápido, dano
  por tempo).

Mesma estrutura da árvore de decisão de encontro (seção 7): "perfis com gatilhos",
reutilizável. O sistema completo é **modelado nos dados desde já**; a exposição é
que é faseada:
- **v0.1:** energia = número único; presets fixos; líquido + bateria.
- **v0.2:** edição de perfis (roteamento customizável de verdade).
- **v0.3:** dumping core, sobrecarga com dano, geradores avançados.

### 8.4 Armamento — três tipos, três pressões de recurso

| Arma | Recurso que consome | Trade-off |
|---|---|---|
| Balística (comum) | Munição (comprar/estocar, ocupa carga) | Barata, mas acaba; sem energia |
| Laser | Energia (muita — pode exigir bateria dedicada) | Munição infinita, mas compete com escudo/thrust |
| Míssil (2 tipos) | Armazenamento (ocupa espaço, estocar) | Alto dano, mas finito e volumoso |

Design: **balística estressa carga, laser estressa energia, míssil estressa
espaço.** Os dois mísseis diferem por papel: um rápido/preciso (anti-nave pequena),
um pesado/lento (anti-nave grande/estrutura).

---

## 9. Identidade e transponder (parcial na v0.1, social na fase 2)

Na v0.1: transponder é dado real e afeta identificação/facção (seção 7.3).

Loop social completo (fase 2+):
- Habilitado por padrão → nave identificável.
- Acessórios suprimem/falsificam.
- **Blitz/fiscalização** pune supressão — contraponto ao contrabando.
- **SOS** em emergência → responder vira profissão (resgate/reparo por dinheiro).

---

## 10. Ferramentas de admin/dev (parte do escopo — UI é prioridade)

Interface de administração para gerar conteúdo sem tocar em código. **A UI é
prioridade mesmo com assets temporários** — é o que destrava gerar conteúdo para
testar. Suporta desenhar in-app OU upload de sprite; arte provisória serve.

Cria e edita:
- **Peças** — características, tier, stats, estados de dano, arte (desenho ou upload).
- **Missões/quests** — tipo, requisitos de nave, recompensas, duração e política de
  encontro.
- **Mapas e locais** — sistemas, rotas, portos, planetas, zonas seguras/perigosas.
- **Facções** — as 3 e sua matriz de relações.
- **NPCs** — builds inimigas, comportamento, loot.
- **Tabelas de drop** — % por tier/fonte/local.
- **Presets de energia** — os perfis fixos da v0.1 e seus gatilhos.

Princípio: conteúdo é **dado editável**, não hard-code. Norte de longo prazo: este
admin vira a **mesa de game master** do mundo vivo (seção 12).

---

## 11. Locais, mundo e interface

### 11.1 Escala do mapa (v0.1): contida

Um sistema contido, tudo se alcança — estilo Expanse. Sem múltiplos sistemas / saltos
na v0.1. Simplifica mapa e viagens.

### 11.2 Tom Expanse

- **Física de foguete abstraída** — viajar é queimar combustível; distância + massa
  vira duração e custo (via atributos, seção 2).
- **Recursos como sobrevivência** — ar/combustível/energia matam se acabam.
- **Geografia política** — as 3 facções com cultura e tensão.
- **Estética industrial** — naves funcionais, gastas, cheias de canos.
- **Fronteira (o Cinturão)** — zona perigosa com alma: mineração, sucata,
  contrabando, resgate.

### 11.3 Tipos de missão

Cada tipo exige uma **configuração de nave diferente** — amarra na montagem, não
são reskins. Leque completo (visão): mineração, entrega, transporte de pessoas,
escolta, busca e apreensão, resgate, exploração, ciência.

**MVP v0.1 — 3–4 tipos que cobrem padrões mecânicos distintos:**
- **Entrega** — leva A→B; testa carga + viagem.
- **Escolta ou Busca e apreensão** — testa armas + encontro.
- **Mineração ou Scavenging** — testa a camada curta / coleta.
- **Resgate** — testa prazo apertado + suporte de vida.

Exploração e ciência dependem de mundo grande (fase 2). Transporte é quase entrega
+ suporte de vida.

### 11.4 Missões dinâmicas — modelo Euro Truck

Sempre há trabalho; missões **expiram e se renovam**, variando em distância, carga,
pagamento e risco. **Meio-termo: sem punir por perder uma, mas nem tudo igual** —
uma expira, outra aparece, com parâmetros e recompensas diferentes. Oportunidade
que passa, não fracasso.

Geradas por **templates + preenchimento contextual**: o template define a estrutura;
o gerador preenche com dados reais do mundo (origem, destino, facção, carga, prazo).
Os templates moram no admin.

O que faz uma missão "sentir viva":
1. **Expiração e escassez** — prazo. Oportunidade, não tarefa. ← v0.1
2. **Origem contextual** — referencia locais/facções reais. ← barato, cabe na v0.1
3. **Consequência no estado do mundo** — cumprir/ignorar muda o mundo. ← fase 2

Esqueleto de template: tipo · requisitos de nave · origem/destino · facção emissora
· recompensa · duração/expiração · política de encontro (seção 7) · risco/zona.

### 11.5 Locais

- **Portos espaciais** — troca, quests, passageiros, manutenção.
- **Planetas** — mesmas funções + mais opções (a definir).
- **Destroços / campos de sucata** — pontos de scavenging.
- **Rotas** — ligam locais; combustível gasta por distância.
- **Zonas seguras vs perigosas** — centro seguro (sem PvP), fronteira perigosa
  (PvP livre, melhor loot). Dá ao jogador controle sobre o próprio risco.

### 11.6 Interface do jogador

- **Tela lateral 2D** — nave-mãe em animação básica (câmera lateral), estados de
  dano visíveis por bloco. Foco visual.
- **Mapa** — starmap com nós e rotas; nave como ponto percorrendo a rota em tempo
  real.
- **Construtor de nave** — montagem por proximidade + modo auto (seção 5.2).
- **Gestão** — inventário, dinheiro, loja, reparo.
- Estética: futurista, simples, legível.

---

## 12. Mundo vivo (VISÃO — com ganchos baratos na v0.1)

O norte de longo prazo: o mundo tem **estado que muda** e responde ao comportamento
agregado dos jogadores. Exige mundo proativo (fase 2) e massa de jogadores, então
**não é v0.1** — mas decisões baratas agora mantêm a porta aberta.

### 12.1 A visão

- **Estações com necessidades e um relógio.** Uma lua/estação precisa de comida. Se
  jogadores atendem, prospera; se ninguém atende, definha e **vira sucata** — um
  novo ponto de scavenging.
- **Ecologia de oportunidade.** Todos fazem transporte → rotas gordas de carga →
  **piratas surgem**. O sistema reage a métricas, não a roteiro.
- **Territórios e conquista (estilo Helldivers).** Mapa macro que muda de mãos por
  esforço coletivo agregado. Coletivo sem interação direta — casa com o assíncrono.
- **Painel de mestre.** O admin observa todas as estações, injeta missões/eventos
  manuais, acompanha métricas, controla fronteiras.

### 12.2 Ganchos baratos na v0.1 (para não reescrever depois)

Campos e carimbos, sem esforço real hoje:
- **Locais têm estado, mesmo que estático.** Campos de necessidades,
  saúde/prosperidade, controle de facção — que na v0.1 nunca mudam.
- **Missões registram efeito, mesmo que ninguém leia.** "Supriu necessidade X da
  estação Y" gravado; nada consome ainda.
- **Toda ação carimba local e facção.** Métricas futuras viram só queries.

---

## 13. Escopo de fases

**v0.1 (MVP jogável):**
- Fundação RPG (ficha de atributos + testes vs DC)
- Multiplayer assíncrono, servidor autoritativo, mundo reativo
- Construtor de nave por proximidade + modo auto
- Peças com tiers, dano em 3 estados, atributos agregados
- Duas camadas de tempo; duração calculada por distância
- Combate automático por snapshot resolvido como RPG (PvP e vs NPC)
- Facção/postura/contexto + motor de resolução + fuga (teste vs DC)
- Energia = número único + presets fixos (Cruzeiro/Combate/Fuga)
- Combustível líquido + bateria; três tipos de arma com pressões de recurso
- 3–4 tipos de missão + missões dinâmicas por template (modelo Euro Truck)
- Quatro fontes de peça + drops configuráveis
- Economia de loop único; peças base gratuitas para recomeço
- Uma nave (arquitetura pronta para várias)
- Mapa contido (um sistema)
- Tela lateral + mapa + gestão
- Admin (UI prioritária, assets temporários) para peças/missões/mapas/facções/NPCs/drops
- Ganchos baratos do mundo vivo (estado em locais, efeito em missões, carimbos)

**Fase 2:**
- Mundo proativo (jobs agendados: NPCs patrulham, mercados flutuam)
- Mundo vivo: estações com estado dinâmico, ecologia de oportunidade, painel de mestre
- Múltiplas naves / frota liberada
- Roteamento de energia editável (perfis customizáveis)
- Transponder social completo (supressão, blitz, SOS, resgate)
- Camada longa: drones, expedições, refino
- Mais tipos de missão (exploração, ciência, transporte)
- Editor de casco cosmético
- Mercado entre jogadores
- Mapa expandido (múltiplos sistemas / saltos)

**Fase 3:**
- Territórios e conquista estilo Helldivers
- Dumping core, sobrecarga com dano, geradores avançados
- Clãs, eventos globais

---

## 14. Decisões em aberto

Poucas restam; a maioria foi fechada. As que sobram são de balanceamento, não de
arquitetura, e podem esperar a prototipagem:

1. **Atributos exatos da ficha RPG** — definir o conjunto final (Mobilidade, Poder
   de Fogo, Blindagem, Escudo, Sensores, Carga, ...) e como cada peça contribui.
2. **Fórmula de duração por distância** — como distância + Mobilidade viram tempo, e
   os cortes que classificam rápida/média/longa.
3. **Detalhe dos 3–4 tipos de missão do MVP** — quais exatamente (Escolta vs Busca e
   apreensão; Mineração vs Scavenging) e seus requisitos de nave.
4. **Curva econômica** — preços, recompensas, custo de reparo, faixas de drop por
   tier. (Ajustável depois via admin.)
5. **Dimensão/limite do espaço de montagem** — quantas peças cabem, o que limita o
   tamanho da nave (massa? energia? um "orçamento" de estrutura?).

---

## Apêndice — decisões já fechadas

- Montagem: **proximidade/grafo**, sem âncora estrutural, com **modo auto**; casco é
  cosmético e posterior.
- Energia: **presets fixos** na v0.1, editável depois.
- Facções: **3, tempero Expanse**.
- Mapa: **contido** (um sistema) na v0.1.
- Prazos de missão: **modelo Euro Truck** (expira e renova, sem punir).
- Admin: **UI prioritária**, desenhar ou upload, assets temporários ok.
- Naves: **uma** na v0.1, arquitetura pronta para várias.
- Tempo: **calculado por distância**, classificado em rápida/média/longa.
- Fuga: **sempre tentável**, com DC baseada nas naves e consequência na falha.
- Filosofia geral: **RPG por baixo** para facilitar balanceamento.

---

## DECISÕES DE MECÂNICA (rodada pós-sweep)

### Start por facção
- Todos começam com o MESMO saldo inicial X de créditos.
- Facção dá desconto em peças temáticas SÓ no start: Luna (transporte/carga),
  Sun (armas), Explorers (radar/mineração). Preço-base igual; modificador de facção
  só na largada.
- [v0.1] X = 3.000 créditos; desconto de facção nas peças temáticas = −20% no start.
  Valores testáveis, ajustar no gameplay.

### Zonas e controle de facção — v0.1 ESTÁTICO
- 12 nós no mapa.
- Cada zona tem % de controle por facção (semente fixa, NÃO muda na v0.1).
- Controle afeta: risco de encontro + preço local. Zonas afastadas nascem sob
  controle pirata = mais risco.
- [FASE 2] controle dinâmico (ações de missão empurram %, muda devagar).

### Mineração
- Fórmula mantida: chance = riqueza_ambiente × (1 − raridade) × eficiência_minerador.

### Resgate (missão)
- Prazo aleatório, enviesado folgado→médio.

### Derrota total
- Ponte-cápsula salva o piloto. Duas saídas:
  (a) resgate automático por VALOR FIXO — saldo pode ficar NEGATIVO;
  (b) aguardar resgate de outro jogador/NPC e oferecer recompensa.
- Peças iniciais de recuperação = sucata grátis: raridade comum, qualidade ≤50%,
  danificadas. Garante que o jogador nunca fica travado sem nave.
- [v0.1] resgate-auto = 800 créditos (≈4 missões base). Saldo negativo: só missões
  pagam de volta; enquanto negativo, compras/upgrades bloqueados, mas navegar e minerar
  com sucata grátis liberados. Valores testáveis.

### Scavenging — existe em DUAS formas
- Ação livre: solo em campo de detritos, chance de drop BAIXA, risco menor.
- Missão de scavenging: mais perigosa (desgaste + ataque + ambiente hostil),
  drop MELHOR.
- Campo define o loot. Peças boas podem estar sob controle pirata (exige combate).
- [v0.1] chance de peça útil por tentativa: campo comum (solo) 25% (quase tudo comum);
  campo de missão 55% (comum/incomum); campo sob controle pirata 75% (chance de raro).
  Qualidade sempre danificada (30–70% condição). Valores testáveis.

### Mercado de peças — v0.1 ESTÁTICO
- Todo porto compra e vende.
- Venda sempre < compra (spread fixo).
- Preços por porto usam o "humor fixo por local" (semente fixa) já definido.
- [FASE 2] preço dinâmico por estoque/fluxo (pouco estoque → paga melhor).

### Sucata vs moeda (distintos)
- Sucata = qualquer peça extra coletada.
- Ao achar peça: ESCOLHER entre (a) levar e instalar (em porto ou nave de
  manutenção) ou (b) vender por créditos.
- Créditos compram: peças, reparo, combustível.

### Reparo x abastecimento
- Abastecimento: INSTANTÂNEO no porto (paga e pronto).
- Reparo: LEVA TEMPO de jogo (como uma missão). Sugestão de fórmula:
  tempo = pontos_a_reparar × k, com k menor em estaleiro grande, maior em porto pequeno.
- [v0.1] tempo = pontos_a_reparar × k. k = 3 s/ponto (estaleiro grande/hub),
  8 s/ponto (porto pequeno). Ex.: 60 pontos = 3 min no hub, 8 min no posto.
  Valores testáveis.
