# Rust and Spark — Inventário de Telas (UX v0.1)

Jogo **web**. Telas pensadas como rotas. Marcação: [v0.1] entra agora, [F2] fase 2.

---

## 1. TELAS DO JOGADOR

### Núcleo do loop
| # | Tela | Papel | Status |
|---|------|-------|--------|
| J1 | **Quadro de missões** | lista que expira/renova (estilo Euro Truck), 5 tipos, filtro por distância/perna/recompensa | [v0.1] |
| J2 | **Mapa** | 12 nós, rotas, controle de facção por zona (estático v0.1), risco, onde há missão/campo | [v0.1] |
| J3 | **Hangar / Montagem** | grafo por adjacência, rotação, diagnóstico de energia (esboço v1/v2 já feito) | [v0.1] |
| J4 | **Relatório narrado** | tela pós-missão; no assíncrono, É a experiência | [v0.1] |
| J5 | **Porto / Estação** | UMA tela com ABAS: mercado (compra/venda peças) · reparo · abastecimento · scavenging livre | [v0.1] |
| J6 | **Trânsito / Status** | o que o jogador vê enquanto a missão processa: tempo restante, perna atual, abortar | [v0.1] |

### Suporte
| # | Tela | Papel | Status |
|---|------|-------|--------|
| J7 | **Inventário / Sucata** | peças coletadas; escolher instalar ou vender | [v0.1] |
| J8 | **Login / Escolha de facção** | onboarding; pega facção (sem troca no MVP) | [v0.1] |
| J9 | **Perfil / Carteira** | saldo (inclusive negativo), facção, histórico de missões | [v0.1] |

### Fase 2
- Ranking / social, contratos entre jogadores, resgate de outro jogador, múltiplas
  naves, mapa de mundo vivo (território dinâmico). [F2]

### Nota de arquitetura de UI
Muitas telas são o mesmo padrão "lista de itens num lugar" (missões, peças no mercado,
sucata). Componentes reaproveitáveis: **card de item** + **painel com abas do porto**
cobrem metade das telas.

---

## 2. TELAS DE ADMIN

Decisão: **tuding em runtime SIM. Tudo no DB desde o começo** (mais esforço, mas
sem dívida de migrar config depois). Escopo v0.1 = A até E. Logs (F) por último,
talvez dispensável.

| # | Tela | O que VÊ / FAZ | Status |
|---|------|----------------|--------|
| A | **Dashboard** | jogadores (ativos/novos/retenção), missões em curso e taxa de sucesso, **winrate real vs 55% do sweep**, economia agregada (créditos no mundo, entra vs sai = inflação), distribuição por tier, alertas (negativo preso, missão travada, pico de falência) | [v0.1] |
| B | **Economia** | preço praticado por porto, peças mais/menos negociadas, circulação de sucata, **ralo econômico** (onde o dinheiro some — confirma desgaste como dreno principal) | [v0.1] |
| C | **Mundo / Mapa** | 12 nós com controle de facção, tráfego por rota, encontros pirata, geração×consumo de missão por zona (zona morta? superlotada?) | [v0.1] |
| D | **Jogadores / Inspetor** | busca + ficha completa (nave, saldo, facção, condição), histórico com replay do relatório narrado, linha do tempo de ações; **ações de suporte**: dar/tirar créditos/itens, destravar, tirar do negativo, banir/resetar | [v0.1] |
| E | **Tuning (runtime)** | editar no painel, sem deploy: números globais (rec_base, desgaste, reparo, drops, upgrades — os do sweep), catálogo de peças (atributos/preço/escala), mapa (controle facção, humor de preço, ambientes), ligar/desligar tipos de missão + taxa de geração; operação: broadcast, modo manutenção, feature flags | [v0.1] |
| F | **Logs / Auditoria** | histórico bruto, replay, caça a exploit — versão simples | [F2 / talvez dispensável] |

### Consequência técnica (registrar no schema)
- TODO número de balanceamento vive no DB (tabela de config/settings), não no código.
- Catálogo de peças, nós do mapa, humor de preço, taxas de missão: todos em tabelas
  editáveis em runtime.
- Inspetor exige histórico de ações do jogador persistido (event log por jogador).
- Replay do relatório narrado exige guardar os eventos da missão, não só o resultado.

---

## 3. PRÓXIMO PASSO — ordem de esboço
Ordem sugerida (como o jogador usa): Quadro de missões (J1) → Mapa (J2) →
Relatório narrado (J4). Porto (J5) e Trânsito (J6) em seguida. Admin depois do núcleo
do jogador. Montagem (J3) já esboçada.

---

## 4. TUTORIAL / ONBOARDING (nota — não construir agora)
Será necessário um tutorial guiando o novo jogador por: montar a primeira nave +
fazer a primeira missão, para entender o fluxo. Objetivo: **bem fluido** — guiar
dentro das telas reais (destaques, dicas contextuais), NÃO uma tela cheia de texto
que trava o jogo. Manter em mente ao desenhar cada tela (cada uma deve ter um
"estado guiado"). Detalhar depois.

---

## 5. FLUXOGRAMA DE NAVEGAÇÃO — validado (v0.1)
Arquivo: fluxograma-navegacao.html · publicado: https://claude.ai/artifact/LZ59WoKW3RGGmvVi879FG5
- **Mapa = hub central** de navegação (confirmado). Porto é onde você "entra" num nó.
- Loop: Mapa → Quadro/despacho → Trânsito → Relatório → Porto → volta.
- Derrota total tem saída própria; nunca trava (resgate-auto pago ou aguardar).
- Admin: árvore rasa a partir do dashboard (A-E); inspetor puxa replay via MissionLog.
- [PENDENTE] usuário vai revisar os CAMINHOS entre telas depois de ver os esboços de
  UX (transições faltantes tendem a aparecer aí).

---

## 6. QUADRO DE MISSÕES (J1) — regras de design confirmadas
- **Por local:** cada nó tem SUA oferta de missões. Viajar muda o que aparece.
- Locais isolados: oferta limitada ou vazia, mas idealmente ≥1 missão. Posto morto
  empurra o jogador pro hub — é decisão de logística, não inconveniência.
- **Card por missão:** tipo (ícone), origem→destino, distância/duração, recompensa,
  risco, nº de pernas. Clicar expande: pernas, ambientes cruzados, controle de zona.
- **Ordenar:** recompensa · distância · risco. **Filtrar:** por tipo.
- **"Expira em X" bem visível** — senso Euro Truck de pega-agora-ou-perde.

---

## 7. QUADRO DE MISSÕES — requisitos, hold e nº de missões (confirmado)

### Uma missão por vez (v0.1)
- Jogador executa **UMA missão ativa por vez**. Sem fila.
- [F2] **fila encadeada** de múltiplas missões numa saída só, com ordenação de
  execução (otimizar trajeto/combustível/desgaste ao longo de uma rota multi-missão).
  É um pilar de gameplay próprio — merece ciclo de design e balanceamento dedicado.
  Aditivo: nada na v0.1 impede. Só entra depois do loop básico validado.

### Requisitos de missão
- Cada missão lista requisitos de nave: vagas de passageiro, capacidade de carga,
  ter arma, velocidade mínima, etc. Checados automaticamente contra a ficha da nave.
- Requisito não cumprido → botão **"Aceitar" DESABILITADO** com o motivo explícito
  ("pede 40 de carga, você tem 15"). Impede pegar (mais limpo que alerta; ensina o
  jogo sozinho, sem desperdício por engano).

### Hold (reserva)
- **Hold = 1 missão** por vez. Reserva pessoal enquanto o jogador vai ao hangar
  ajustar a nave para cumprir o requisito.
- Volta ao quadro cumprindo o requisito → consegue aceitar.
- Timer de expiração **continua correndo** durante o hold (reserva não congela prazo).
- Expirou no hold → mostra **"expirada (prazo de início)"**, sem punição além de
  perder a oportunidade.

### Detalhe de controle de zona (UI)
- No card expandido, o controle de facção por perna fica atrás de **hover/botão**
  ("mostrar controle das zonas"), não sempre visível — limpo por padrão, detalhe sob
  demanda. Só dentro do card expandido.

---

## 8. PALETA DE FACÇÕES (canônica — usar na implementação)
Cores escolhidas para MÁXIMA distinção (piratas e Sun não podem colidir):
- **Luna** = azul `#4a90d9`
- **Sun** = amarelo `#e3b341`
- **Explorers** = verde `#3fa66a`
- **Piratas** = vermelho `#c23b3b`
- **Neutro/disputado** = cinza `#5a6273`

Risco (anéis/pills), ajustado para não colidir com o amarelo do Sun:
- baixo = verde `#2ea043` · médio = laranja `#e8833a` · alto = vermelho `#f85149`

---

## 9. RELATÓRIO NARRADO (J4) — estrutura confirmada (revisada)
No jogo assíncrono, o relatório É a experiência — mas NÃO pode cansar quem lê toda missão.
Solução: **TRÊS VIEWS dos mesmos eventos estruturados**, o resumo como padrão.

### View A — Resumo curto (PADRÃO, sempre visível)
- 2-3 linhas do que importou + resultado + saldo. É o que 90% lê, toda vez.
- Inverte o padrão anterior (longo era default; agora o longo é opt-in).

### View B — Narrativa completa (opt-in, toggle)
- Os capítulos por perna, tom Expanse, número inline discreto ao lado da frase,
  eventos grandes com "ver descrição completa". Para o aficionado por RPG.

### View C — Log linha-a-linha (opt-in, toggle) — SUBSTITUI a tabela
- Estilo log de servidor: uma linha por evento, cronológica, auto-explicativa.
  Formato: [perna · categoria] descrição — efeito. Ex.:
    P2 · combate    dano recebido       −31 HP
    P2 · loot       regulador (comum)   58%
    P3 · falha      propulsor travou    cond 24%
    fim · pagamento prêmio da missão    +920 ¢
- Some com a tabela antiga (confusa: cruzava eixos que não se relacionam).

### DECISÃO DE ARQUITETURA — geração de narrativa SEM LLM
- Narração por **template/mad-libs determinístico**: cada tipo de evento tem um
  conjunto de frases-molde com lacunas ({inimigo}, {peça}, {resultado}). O motor
  de missão produz os dados; a narração escolhe um molde e preenche.
- **Determinístico e reproduzível** (semente da missão) — essencial para o replay
  do admin. Sem IA em runtime. Variedade = escrever vários moldes por evento (conteúdo).
- As três views (A/B/C) são renderizações dos MESMOS eventos estruturados.

---

## 10. PORTO (J5) — notas de design que emergiram do esboço

### Confirmado no esboço
- Tela única com 4 abas (mercado, reparo, fuel, scavenging).
- Mercado: grade de cards compactos, raridade + condição visíveis, clique abre ficha
  completa (popup). Compra 100% base / venda ~60% × condição. Peças usadas no mercado
  (condição <100%) confirmadas.
- Reparo: slider por peça (condição atual → 100%) + botão "reparar tudo".
- Abastecer: instantâneo + botão "encher tanque".
- **Comprar/vender exige popup de CONFIRMAÇÃO** (evita ação acidental).

### Inventário de peças coletadas ≠ inventário de carga (bom, manter)
Separação natural que preserva a imersão: peças que você coleta (loot/scavenging) vão
para um inventário próprio, distinto da carga das missões. NÃO misturar.

### [v0.2] Limitar o inventário de peças (evitar mochila infinita)
Inventário infinito mata a economia (acumula tudo, nunca precisa vender). Precisa de
limite. Opções na mesa (decidir na v0.2):
- por **slots** (X peças) — simples de entender
- por **massa/volume** — mais físico, casa com o resto do jogo (que já pensa em massa)
- guardado na **capacidade de carga da nave** vs **armazém no porto** (com aluguel?)
Provisório v0.1: sem limite (PoC), mas projetar o schema já prevendo o campo de
capacidade para não quebrar depois.
