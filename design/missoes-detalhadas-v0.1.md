# Tipos de Missão — Spec Detalhada (v0.1)

> Cada tipo especificado para implementação e simulação: fluxo, requisitos de nave,
> resolução, pagamento, falhas, e facção emissora.

---

## Princípio unificador: missão = sequência de PERNAS (legs)

Toda missão é uma sequência de **pernas**, e cada perna é uma viagem entre dois nós
que pode conter um encontro (combate/fuga). Isso mantém o motor de resolução ÚNICO:
- Entrega = 1 perna (A→B).
- Escolta = 1-2 pernas (opcional ir até A; depois A→B protegendo).
- Resgate = 2 pernas (ida ao alvo, volta com o alvo).
Cada perna resolve: combustível, ambiente/desgaste, encontro. O tipo de missão só
muda os requisitos, o pagamento e as condições de sucesso/falha.

Campos comuns de toda missão:
`id · tipo · facção_emissora · origem · destino · pernas[] · requisitos_nave ·
recompensa · prazo/expiração · política_encontro · risco/zona`

---

## 1. ENTREGA (carga)  — emissor típico: Luna

**Fluxo:** pega carga na origem → viaja A→B (1 perna) → entrega em B. Volta opcional
(pode pegar nova missão em B).

**Requisitos:** espaço de carga suficiente, do tipo certo:
- normal (genérica) · refrigerada (perecíveis) · blindada (contrabando/frágil).

**Resolução:** resolve a perna (combustível + ambiente + encontro). Sucesso = chegar
em B com a carga intacta.

**Pagamento:** `dist × k_dist + perigo × k_perigo + bônus_tipo_carga`. Carga
especial (refrigerada/blindada) paga mais.

**Falhas:**
- Nave derrotada em combate → carga roubada (pirata) ou perdida → missão falha.
- Sem combustível pra completar → falha (mas nave não morre; fica à deriva/resgate).
- Carga refrigerada + falha de energia (refrigeração desliga) → carga estraga.

---

## 2. TRANSPORTE (pessoas) — emissor típico: Luna / Sun

**Fluxo:** igual entrega, mas a "carga" são passageiros (civis, VIPs, prisioneiros).

**Requisitos:** cabine pressurizada + suporte de vida ativo (não só a cápsula de
emergência da ponte).

**Resolução:** perna A→B. Sucesso = passageiros chegam vivos.

**Pagamento:** melhor que carga comum (vidas valem mais). VIP/prisioneiro paga
prêmio.

**Falhas (mais graves que carga):**
- Nave destruída / decompressão / suporte de vida falha → passageiros morrem →
  falha grave (penalidade de reputação maior).
- Prisioneiro: se a nave é derrotada, o prisioneiro pode escapar.

---

## 3. ESCOLTA — emissor típico: Sun

**Fluxo:** (opcional) ir até o ponto A encontrar a nave-cliente (NPC) → viajar A→B
junto, defendendo-a → sucesso quando a nave-cliente chega a B. Volta opcional.

**Requisitos:** armas + mobilidade (precisa poder lutar e acompanhar).

**Resolução:** nas pernas com a nave-cliente, encontros são MAIS prováveis (a escolta
atrai/enfrenta ataques). Combate provável. A nave-cliente tem HP próprio; se ela cai,
a missão falha mesmo que o jogador sobreviva.

**Pagamento:** alto — proporcional ao perigo da rota + número de combates. Paga por
proteger, não só por chegar.

**Falhas:**
- Nave-cliente destruída → falha (o jogador pode sobreviver e ainda falhar).
- Jogador foge do combate → abandona o cliente → falha + reputação.

---

## 4. MINERAÇÃO — emissor típico: Explorers

**Dois modos:**
- **Contratada:** "traga Y unidades do material Z" → paga fixo ao entregar.
- **Livre:** minera o que quiser e vende por conta (preço por local — economia).

**Fluxo:** viaja até um nó de mineração (campo/asteroide) → minera (tentativas) →
volta pra vender/entregar.

**Requisitos:** equipamento de mineração + espaço de carga.

**Resolução — chance de achar material:**
```
chance_por_tentativa = riqueza_do_ambiente × (1 - raridade_do_material) × eficiência_minerador
```
Cada tentativa consome tempo (e um pouco de desgaste/combustível). Material raro =
menos chance, mais valor. Ambiente rico = mais chance. Minerador melhor = mais
eficiência.

**Pagamento:**
- Contratada: fixo, mas exige a quantidade certa (risco de não achar o suficiente).
- Livre: variável, depende do que achou e do preço no local de venda (comprar barato
  onde é abundante, vender caro onde é escasso — gancho de comércio).

**Falhas:**
- Não achar material suficiente no prazo (contratada) → falha parcial.
- Nave cheia de minério é lenta e cobiçada → alvo de piratas na volta.

---

## 5. RESGATE — emissor típico: Explorers / Sun

**Fluxo:** viaja até o local do alvo (destroço, nave em perigo, estação) → pega o
alvo (carga / pessoas / peças) → traz de volta (2 pernas: ida + volta).

**Requisitos:** espaço adequado ao que resgata (carga OU pressurizado p/ pessoas) +
frequentemente velocidade (resgate tem PRAZO — "chegar antes do ar acabar").

**Resolução:** ida ao alvo, coleta, volta. O prazo é o aperto central — nave lenta
pode não chegar a tempo. Encontros na volta (carregando o resgatado).

**Pagamento:** alto, urgência premium. Peças resgatadas podem ser loot valioso.

**Falhas:**
- Não chegar no prazo → o alvo se perde (pessoas morrem / carga destruída) → falha.
- Nave derrotada na volta → perde o resgatado.

---

## 6. Requisitos → montagem (resumo)

| Missão | Exige na nave | Facção típica |
|---|---|---|
| Entrega | carga (tipo certo) | Luna |
| Transporte | cabine pressurizada + suporte de vida | Luna / Sun |
| Escolta | armas + mobilidade | Sun |
| Mineração | equip. mineração + carga | Explorers |
| Resgate | espaço p/ alvo + velocidade | Explorers / Sun |

A nave que você monta decide que missões pode pegar → identidade emergente. A facção
escolhida no início enviesa o quadro de missões inicial para o tipo dela.

---

## 7. Geração (template)

Quadro de missões em cada porto, modelo Euro Truck (sempre há opções, expiram e
renovam). Um template define a estrutura; o gerador preenche com dados reais:
tipo · facção · origem/destino (nós reais) · carga/alvo · recompensa (faixa) ·
prazo · ambiente das pernas · política de encontro. Sabor contextual barato:
"Estação X precisa de Y porque Z" usando nomes reais do mapa.

---

## 8. A calibrar (via simulador / jogando)
- Constantes de pagamento (k_dist, k_perigo, bônus por tipo).
- Chance de mineração (riqueza × raridade × eficiência) — valores concretos.
- Aperto do prazo de resgate.
- Quão mais provável é encontro durante escolta.
- Penalidades de reputação por tipo de falha.

---

## INTEGRIDADE DO OBJETO E PRÊMIO PARCIAL (regra econômica)

Separa consequência MECÂNICA (dano à nave) de consequência ECONÔMICA (prêmio). Uma
não justifica a outra — cada evento tem sua categoria.

### O objeto da missão tem integridade
- Toda missão tem um **objeto**: a carga (entrega), o passageiro (transporte), a
  nave-escoltada (escolta), o resgatado (resgate). Minério (mineração) é caso à parte.
- O objeto tem **integridade 0–100%**. Dano durante as pernas (combate, ambiente)
  reduz essa integridade.
- **É o dano ao OBJETO que conta, não à sua nave.** Sua nave danificada é problema
  seu (custo de reparo depois); o cliente paga pela mercadoria em bom estado.

### Prêmio parcial — linear com piso em 50%
- **Prêmio = base × integridade**, LINEAR entre 100% e 50%.
  - integridade 100% → 100% do prêmio
  - integridade 80% → 80% do prêmio
  - integridade 50% → 50% do prêmio (limite)
- **Abaixo de 50% → prêmio ZERO.** Objeto danificado demais; entrega recusada.
- Piso duro (zero, sem migalha). O tom é "meio pra hard", e o resgate-auto + sucata
  grátis já garantem que o jogador nunca trava — então dá pra ser duro aqui.

### Consequência para os eventos estruturados (relatório)
- **Falha de peça** = evento categoria `falha`, efeito MECÂNICO puro (peça trava →
  afeta a missão: aborta, atrasa, reduz performance, ou expõe o objeto a dano).
  NUNCA embute perda de dinheiro.
- **Pagamento** = evento categoria `pagamento`, calculado pela regra acima a partir
  da integridade final do objeto. Independente de qual peça falhou.
- A narração pode LIGAR os dois ("o propulsor falhou e o comboio tomou dano"), mas o
  número vem da regra de integridade, não da história.

### Por tipo de missão (como o objeto toma dano)
- **Entrega:** carga exposta a dano em combate/ambiente conforme proteção da nave.
- **Transporte:** passageiro; dano se a nave é atingida sem escudo/blindagem.
- **Escolta:** a nave-NPC escoltada tem HP próprio; se cai a <50%, prêmio zero; se é
  destruída, falha total.
- **Resgate:** o resgatado; prazo apertado + dano na volta.
- **Mineração:** sem "integridade de objeto" — o produto é o minério coletado; a
  penalidade é render menos, não prêmio parcial.
