# Schema de Dados Canônico — Rust and Spark (v0.1)

> Fonte de verdade única. Cada entidade descrita em campos, prontos para virar
> tabela (Postgres) ou struct. Marca [v0.1], [derivado] (calculado, não armazenado)
> e [fase 2] (gancho, existe no schema mas inerte no MVP).
> Onde houver conflito de números entre os outros docs, ESTE manda.

Princípios:
- **A ficha da nave é DERIVADA das peças, nunca armazenada.** Só se guarda a lista de
  peças + posições + condição. Atributos (MOB, PDF, HP...) recalculam-se.
- **Jogador e NPC compartilham a estrutura de nave.** Um NPC é uma nave + política.
- **Missão = sequência de pernas.** (ver missoes-detalhadas)
- **Locais têm estado** mesmo que estático na v0.1 (gancho mundo vivo).
- IDs são chaves; tudo referencia por ID.

---

## 1. PART_CATALOG (definição estática de peça) [v0.1]
A "planta" de uma peça. Imutável; instâncias referenciam por `part_type`.
```
part_type      : str  (PK) — 'motor_g', 'placa', ...
name           : str
classe         : enum — motor|tanque|bateria|reator|arma|defesa|carga|sensor|utilitario|ponte
tier           : enum — comum|incomum|rara|epica|lendaria
w, h           : int  — tamanho em células (grade de montagem)
mass           : num
custo_estrutura: int  — pontos do orçamento da ponte que ocupa
preco_base     : int  — ¢ (modulado por local na compra)
valor_sucata   : int
hp_peca        : int  — vida da peça
# contribuições para a ficha (0 se n/a):
pot, PDF, BLI, ESC, SEN, CRG, MIN : num
energia_cont   : num  — +gera / -consome contínuo (cruzeiro)
energia_combate: num  — -consome só em combate (laser, escudo)
fuel_cap       : int  — se tanque
fuel_use       : num  — consumo por 100 dist (se motor químico)
bat_carga, bat_output, bat_input : num  — se bateria
prop_especial  : json — [fase 2] efeitos de tier alto (ex. overdrive)
```

## 2. PART_INSTANCE (peça que existe no jogo) [v0.1]
Uma peça concreta, no inventário ou instalada. Tem condição (desgaste).
```
id          : uuid (PK)
part_type   : FK -> part_catalog
owner_id    : FK -> player (ou npc)
condicao    : num (0-100) — 100 nova; inicial grátis vem ~80
location    : enum — inventario | instalada
prop_especial_roll : json — [fase 2] se tier alto, o efeito sorteado
```

## 3. SHIP (nave) [v0.1]
Guarda só o que NÃO é derivável. A ficha é calculada das peças instaladas.
```
id        : uuid (PK)
owner_id  : FK -> player | npc
name      : str  — nome exibido (alterável por chip de transponder [fase 2])
layout    : json — [ {part_instance_id, gx, gy, rot} ]  (posições na grade)
fuel      : num  — combustível carregado atual
status    : enum — no_porto | em_missao | a_deriva
# [derivado] recalculado do layout+condição, NUNCA armazenado:
#   MOB, PDF, BLI, ESC, SEN, CRG, HP, massa, energia_cont, energia_combate,
#   output_total, fuel_cap, classe, viavel(bool), problemas[]
```

## 4. PLAYER [v0.1]
```
id        : uuid (PK)
name      : str
faccao    : FK -> faction  — escolhida no início
creditos  : int
sucata    : int  — material de desmonte (moeda secundária)
inventory : (via part_instance.owner_id = player)
ships     : (via ship.owner_id) — 1 na v0.1, N no schema [fase 2 libera]
reputacao : json — [fase 2] {faction_id: valor}
created_at: ts
```

## 5. NPC [v0.1]
Mesma nave que o jogador; difere só por ser gerado e ter política.
```
id        : uuid (PK)
tipo      : enum — pirata | escolta_cliente | faccao_patrulha
faccao    : FK -> faction (piratas = facção própria hostil)
ship      : FK -> ship (gerada por template + orçamento de pontos)
politica  : json — {postura, arvore_decisao}  (facção/postura/contexto)
loot_table: FK -> drop_table
```

## 6. FACTION [v0.1]
```
id        : str (PK) — 'luna' | 'sun' | 'explorers' | 'piratas'
name      : str
descricao : str
relacoes  : json — {other_faction: aliado|neutro|inimigo}
# v0.1: todos neutros; piratas inimigo de todos
vies_inicial : json — [opcional] bônus de start (créditos/peça)
```

## 7. LOCATION (nó do mapa) [v0.1]
```
id          : int (PK)
name        : str
tipo        : enum — porto | planeta | campo_sucata | posto_fronteira
x, y        : num  — posição no starmap
zona        : int (0-3) — centro..fronteira
faccao_dona : FK -> faction
isolamento  : num  — multiplicador de preço (0.9 hub .. 2.0 remoto)
humor_preco : num  — variação fixa por local (0.85-1.15), semente fixa
servicos    : json — {compra, venda, reparo, missoes, passageiros} bool
# [fase 2] estado do mundo vivo (inerte na v0.1):
necessidades : json  — {recurso: quantidade}
prosperidade : num
```

## 8. ROUTE (aresta do mapa) [v0.1]
```
id        : int (PK)
node_a    : FK -> location
node_b    : FK -> location
distancia : int  — alimenta tempo e combustível
perigo    : int (0-10) — chance de encontro
ambientes : [str] — 1-2 de {aberto, radiacao, detritos, gravitacional}
```

## 9. ENVIRONMENT (tipo de ambiente) [v0.1]
```
id         : str (PK)
name       : str
nivel      : num  — intensidade de desgaste
fuel_mult  : num  — gasto extra de combustível
alvo       : enum — subsistema mais afetado (informativo)
peca_mitiga: str  — que peça reduz o efeito
```

## 10. MISSION_TEMPLATE (gerador) [v0.1]
```
id            : str (PK)
tipo          : enum — entrega|transporte|escolta|mineracao|resgate
faccao_emissora: FK -> faction
requisitos    : json — {carga?, pressurizado?, armas?, minerador?, velocidade?}
recompensa_calc: json — fórmula {k_dist, k_perigo, bonus_tipo}
prazo_calc    : json — como o prazo é derivado
politica_encontro: json — comportamento se interceptado
```

## 11. MISSION_INSTANCE (missão ativa) [v0.1]
```
id          : uuid (PK)
template_id : FK -> mission_template
tipo        : enum
faccao      : FK -> faction
origem      : FK -> location
destino     : FK -> location
pernas      : json — [ {de, para, route_id} ]
carga_alvo  : json — {tipo, quantidade} ou {pessoas} ou {material}
recompensa  : int
prazo       : ts  — quando expira / deadline de conclusão
status      : enum — disponivel | aceita | em_curso | concluida | falha | expirada
player_id   : FK -> player (null se ainda no quadro)
```

## 12. DROP_TABLE (loot configurável) [v0.1]
```
id      : str (PK)
fonte   : enum — scavenging | npc_comum | npc_elite | quest
faixas  : json — [{tier, chance%}]  — editável no admin
```

## 13. MISSION_REPORT (relatório narrado) [v0.1]
```
id         : uuid (PK)
mission_id : FK
player_id  : FK
eventos    : json — [ {tipo_evento, dados} ]  (motor gera; narração traduz)
resultado  : enum — sucesso | falha | parcial
recompensa_paga : int
desgaste   : json — {part_instance_id: dano}
narrativa  : text — o log em texto (montado das frases por evento)
created_at : ts
```

---

## Relações (resumo)
- player 1—N part_instance (inventário) · player 1—N ship (1 ativo v0.1)
- ship 1—N part_instance (instaladas, via layout)
- part_instance N—1 part_catalog
- npc 1—1 ship · npc N—1 faction · npc N—1 drop_table
- location N—1 faction · route N—2 location · route N—M environment
- mission_instance N—1 template · N—2 location · N—1 player
- mission_report N—1 mission_instance

## O que é [derivado] e nunca se armazena
A ficha inteira da nave (MOB, PDF, BLI, ESC, SEN, CRG, HP, massa, energias, output,
classe, viabilidade). Recalcula-se do layout + condição das peças a cada mudança.
Isto evita estado inconsistente e é a base do "montagem importa".

## Ganchos [fase 2] presentes no schema mas inertes
- player.reputacao · ship.name alterável (chip transponder) · location.necessidades
  e prosperidade · part.prop_especial · múltiplas ships por player.

---

## ADENDO — exigências do tuning em runtime + admin (decisão UX)

Decisão: tudo de config no DB desde o começo. Isso adiciona/reforça entidades:

### 14. GameConfig (settings globais)
Todo número de balanceamento editável em runtime. Não no código.
- `key` (ex.: rec_base, preco_reparo, desg_base, desg_ambiente, drop_campo_comum...)
- `value`, `type`, `updated_at`, `updated_by` (auditoria de quem mudou)
- Alternativa: uma linha por número, ou um documento de config versionado.

### 15. PlayerEvent (event log por jogador)
Necessário para o inspetor de admin e a linha do tempo.
- `player_id`, `timestamp`, `type` (comprou, reparou, morreu, resgatado, upgrade...),
  `payload` (detalhe), `credits_delta`
- É a fonte de verdade para auditoria e suporte.

### 16. MissionLog (eventos ESTRUTURADOS da missão)
O relatório narrado é RE-exibível no admin (replay) E tem 3 views (resumo/narrativa/log).
Guardar EVENTOS ESTRUTURADOS, **nunca o texto narrado** — o texto é gerado na hora
de exibir, por template determinístico.
- `mission_id`, `player_id`, `seed` (semente p/ narração reproduzível), `outcome`
- `legs[]`, cada uma com `events[]`. Cada evento é ESTRUTURADO:
    `{leg, category (combate|ambiente|loot|falha|pagamento|transito),
      type, actors{}, effects{hp, cond_by_part, credits, loot[]}, magnitude}`
- Nada de string narrada persistida. As 3 views (resumo/narrativa/log) são
  renderizações destes mesmos eventos:
    - resumo = os eventos de maior magnitude, condensados
    - narrativa = molde de texto por evento + lacunas preenchidas com actors/effects
    - log = uma linha por evento (category, type, effect)
- Vantagem: reescrever moldes depois não quebra histórico; economiza espaço.

### Tabelas de mundo editáveis em runtime (reforço)
- Catálogo de peças, nós do mapa, controle de facção por zona, humor de preço por
  local, taxa de geração de missão: TODAS em tabelas editáveis pelo admin (tela E),
  não hard-coded.
