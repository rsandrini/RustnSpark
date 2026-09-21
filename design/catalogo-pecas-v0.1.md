# Catálogo de Peças — Propriedades e Valores (v0.1)

> "Bate o martelo" nas propriedades de cada classe de peça. Valores **provisórios**
> para o simulador. Toda peça compartilha um núcleo comum de propriedades + as
> específicas da sua classe.

---

## Propriedades comuns a TODA peça

| Propriedade | Descrição |
|---|---|
| **id / nome** | identificador |
| **classe** | motor, bateria, arma, casco, carga, sensor, etc. |
| **tier** | comum / incomum / rara / épica / lendária |
| **massa** | quanto pesa (entra no cálculo de MOB e no orçamento) |
| **custo_estrutura** | pontos do orçamento da ponte que ocupa (tier alto = mais compacto) |
| **preço_¢** | custo de compra |
| **valor_sucata** | ao desmontar |
| **HP_peça** | vida da peça (dano/reparo por bloco) |
| **energia** | +gera ou −consome (0 se neutro) |

`custo_estrutura` é o **limite anti-"nave que faz tudo"** (ver escopo §orçamento).
`massa` é o limite dinâmico (puxa MOB). `energia` é o limite operacional.

### Nota de escala (rodada 2 de peças)
Números da rodada 1 eram pequenos e apertados demais (tanque 20, consumo 1,2),
tornando o balanceamento frágil e tudo "no talo". **Reescalados** para escala de
nave, com FOLGA calibrada:
- Combustível em milhares (tanque inicial ~1.000, cargueiro ~3.000).
- Consumo tal que viagem **curta ~10%** do tanque, **média ~26%**, **longa ~58%**
  (aperta só quando ambicioso — 2 longas seguidas exigem reabastecer).
- Energia em dezenas/centenas (motor químico médio gera +70; iônico médio consome
  −90; nuclear +180).
- Distâncias do mapa em centenas (curta 300, média 800, longa 1.800).
- Recompensas em centenas a milhares, proporcionais.
> Alavanca em aberto: **preço do combustível**. Após reescalar, as margens ficaram
> gordas (fuel barato demais relativo à recompensa). Subir o preço de recarga para
> devolver tensão econômica — calibrar na próxima rodada de economia.

---

## Tabela mestre de escala (valores vigentes rodada 2)

| Grupo | Antigo (r1) | Novo (r2) |
|---|---|---|
| Tanque pequeno | 20 | 1.000 |
| Tanque grande | 50 | 3.000 |
| Consumo motor médio | 1,2/un | 32/100un |
| Energia motor médio | +4 | +70 |
| Energia iônico médio | −8 | −90 |
| Nuclear | +10 | +180 |
| Painel | +3 | +30 |
| Bateria peq carga/output | 30/8 | 300/80 |
| Bateria gra carga/output | 90/20 | 900/200 |
| Distância curta/média/longa | 5/10/20 | 300/800/1.800 |

> As tabelas por-peça abaixo ainda mostram valores da rodada 1 em alguns campos;
> a Tabela mestre acima é a referência de escala. Reconciliar na próxima limpeza.

---

## 1. PONTE DE COMANDO (obrigatória, peça-mãe)

A nave em miniatura. Define o **orçamento de estrutura** e traz o mínimo de
sobrevivência embutido — a "cápsula" que mantém o piloto vivo quando a nave é
devastada.

| Propriedade | Ponte básica (inicial) |
|---|---|
| custo_estrutura FORNECIDO | **+100** (é a fonte do orçamento, não gasta) |
| massa | 4 |
| **transponder embutido** | sim (identidade; ver chip §9) |
| **suporte de vida de emergência** | O₂ mínimo + proteção de radiação mínima |
| **bateria mínima embutida** | carga 10, output 3 (só o essencial) |
| energia | −1 (a própria ponte consome pouco) |
| HP_peça | 30 (a última a cair) |
| preço_¢ | — (vem grátis / recomeço) |

Regra de sobrevivência: se a nave é reduzida à ponte, o piloto sobrevive com O₂/
energia de emergência (tempo limitado → gancho SOS/resgate). É o "nunca fica preso".

Upgrade futuro: pontes de classe superior dão mais orçamento de estrutura (= naves
maiores).

---

## 2. MOTORES

Dois tipos base + endgame. MOB = Σpotência ÷ massa_total × 1.6.

### 2.1 Motor químico (líquido)
| Prop | Pequeno | Médio | Grande |
|---|---|---|---|
| potência | 25 | 40 | 70 |
| massa | 3 | 6 | 14 |
| consumo_líquido /un | 0,7 | 1,2 | 2,5 |
| **energia** | **+2** | **+4** | **+7** (gera! carrega baterias) |
| custo_estrutura | 6 | 10 | 20 |
| preço_¢ | 100 | 300 | 800 |

Motor químico **gera energia** e carrega baterias. Output extra é jogado fora.
Exige tanque (§3).

### 2.2 Motor iônico / elétrico
| Prop | Pequeno | Médio |
|---|---|---|
| potência | 12 | 22 |
| massa | 4 | 8 |
| consumo_líquido | 0 (nenhum!) | 0 |
| **energia** | **−4** | **−8** (CONSOME muito) |
| custo_estrutura | 7 | 12 |
| preço_¢ | 250 | 600 |

Muito menos thrust, mas **dispensa tanque**. Em troca exige bateria + fonte de
recarga (painel/reator). Pode-se combinar químico + iônico (mais peso, mais
flexibilidade).

### 2.3 Dumping core (ENDGAME)
| Prop | Valor |
|---|---|
| potência | 200+ |
| massa | 20 |
| consumo | ~0 (recarrega raramente) |
| energia | +20 |
| custo_estrutura | 25 |
| preço_¢ | caríssimo (endgame) |
| **risco** | se destruído → **explosão fatal** na nave inteira |

"Compra e esquece." Thrust absurdo, quase sem consumo. O risco é catastrófico se a
peça for destruída em combate. Sua assinatura de thruster é rastreável (§9).

---

## 3. TANQUES DE COMBUSTÍVEL (líquido)
| Prop | Pequeno | Grande |
|---|---|---|
| capacidade_líquido | 20 | 50 |
| massa (vazio) | 2 | 5 |
| massa por unidade de fuel | 0,1 | 0,1 (fuel pesa!) |
| custo_estrutura | 4 | 9 |
| preço_¢ | 80 | 200 |

Só necessário com motor químico. Fuel carregado adiciona massa (tanque cheio pesa).

---

## 4. BATERIAS
Três números-chave: **carga máx**, **output máx** (tem que ≥ consumo total ativo),
**input máx** (velocidade de recarga).

| Prop | Pequena | Grande |
|---|---|---|
| carga_máx | 30 | 90 |
| **output_máx** | 8 | 20 |
| input_máx (recarga/un tempo) | 4 | 10 |
| massa | 5 | 14 (pesadas!) |
| custo_estrutura | 6 | 14 |
| preço_¢ | 150 | 400 |

Restrição: **output_máx total ≥ consumo total da nave** quando tudo ligado, senão
sistemas desligam. Nave grande com muitos sistemas precisa de várias baterias (peso)
ou uma grande. A matemática consumo vs recarga vs output é um quebra-cabeça real.

---

## 5. FONTES DE RECARGA (além do motor químico)
| Prop | Painel solar | Gerador nuclear |
|---|---|---|
| energia (+gera contínuo) | +30 (perto de estrela) | +180 (alto, constante) |
| massa | 2 | 14 |
| consumo_insumo | 0 (grátis, lento) | consome combustível nuclear (lento) |
| custo_estrutura | 3 | 18 |
| preço_¢ | 300 | caro (endgame médio) |

Painel: fraco, grátis, complementar. **Nuclear: a peça que torna motor iônico
médio+ viável** — solar sozinho não sustenta iônico grande.

### 5.1 Árvore de progressão de propulsão (a história dos motores)
Emergente dos trade-offs, quatro degraus:
- **Nave minúscula** → iônico pequeno + bateria + painel. Funciona, mas tartaruga.
  O starter sem grana.
- **Nave média** → nuclear + solar alimentando iônicos maiores. Nuclear resolve a
  energia; eficiência sem tanque.
- **Nave complexa (híbrida)** → "carro híbrido espacial": motor químico tradicional
  carregando baterias *enquanto* iônicos dão eficiência. Melhor dos dois mundos, ao
  custo de peso e complexidade.
- **Endgame** → dumping core (§2.3). Esquece que existe.

---

## 6. ARMAS
| Prop | Balística | Laser | Míssil leve | Míssil pesado |
|---|---|---|---|---|
| PDF | +3 | +4 | +5 (2d6) | +8 (2d6) |
| recurso | munição | energia | mísseis (estoque) | mísseis (estoque) |
| energia | 0 | −5 | 0 | 0 |
| massa | 3 | 4 | 3 | 6 |
| custo_estrutura | 5 | 7 | 5 | 9 |
| preço_¢ | 120 | 350 | 200 | 450 |
| nota | barata, munição acaba | ignora bônus escudo | rápido, anti-nave pequena | lento, anti-estrutura |

Balística estressa carga (munição estocada), laser estressa energia, míssil estressa
espaço. Nenhuma faz tudo.

---

## 7. DEFESA

### 7.1 Casco / placas
| Prop | Casco básico | Placa militar |
|---|---|---|
| BLI | +2 | +5 |
| HP | +20 | +40 |
| massa | 4 | 10 |
| custo_estrutura | 5 | 12 |
| preço_¢ | 100 | 500 |
| nota | fácil reparar/trocar | pesada, cara, forte |

### 7.2 Gerador de escudo
| Prop | Básico |
|---|---|
| ESC | +6 (absorve antes do HP) |
| energia | −6 (gasta bateria pra manter ligado) |
| regen | +2/round se houver energia |
| massa | 4 |
| custo_estrutura | 7 |
| preço_¢ | 400 |

(Dissipador de calor REMOVIDO para simplificar — sem mecânica de calor na v0.1.)

---

## 8. CARGA E PASSAGEIROS
| Prop | Carga normal | Refrigerada | Blindada | Pressurizado (pax) |
|---|---|---|---|---|
| CRG (slots) | +5 | +3 | +2 | +2 (pessoas) |
| massa (vazio) | 2 | 3 | 4 | 3 |
| energia | 0 | −2 (refrigeração) | 0 | −2 (suporte vida) |
| custo_estrutura | 4 | 6 | 7 | 6 |
| preço_¢ | 80 | 200 | 250 | 220 |
| nota | genérica | perecíveis | contrabando/frágil | passageiros/prisioneiros |

Pressurizado exige suporte de vida ativo (não só o de emergência da ponte).

---

## 9. SENSORES, IDENTIDADE E UTILITÁRIO

| Prop | Radar | Antena | Kit reparo | Equip. mineração | Coletor gelo |
|---|---|---|---|---|---|
| efeito | SEN +4 | habilita quests contato | repara em viagem | extrai minério | repõe O₂ |
| energia | −2 | −1 | −1 | −3 | −1 |
| massa | 2 | 1 | 3 | 8 | 2 |
| custo_estrutura | 4 | 2 | 5 | 10 | 3 |
| preço_¢ | 200 | 60 | 150 | 400 | 90 |

### 9.1 Chip de supressão/falsificação de transponder (NÃO é peça — é consumível)
- **Formato cartão/chip**, caro, uso único ou limitado.
- Altera **nome e assinatura** da nave (bloco principal/ponte).
- Também pode alterar a **assinatura do thruster** (relevante p/ rastrear naves com
  dumping core, cuja assinatura é característica).
- Não ocupa estrutura fixa — é item de inventário aplicado.
- Uso social completo (blitz, contrabando) é fase 2; na v0.1 existe como conceito.

---

## 10. VIABILIDADE (condicional à build, não lista fixa)

Distinção importante de energia (descoberta no teste):
- **Energia contínua** (motores iônicos, radar, refrigeração, suporte de vida) — tem
  que fechar SEMPRE (geração ≥ consumo em cruzeiro).
- **Energia de combate** (laser, escudo) — drena só durante o combate, coberta pela
  **bateria** (output + carga). Por isso a bateria existe: absorver picos de combate.

A nave é despachável se TODOS os balanços fecham:

1. **Ponte** presente (1, sempre).
2. **Propulsão:** MOB ≥ 1 (potência ÷ massa suficiente).
3. **Combustível:** se motor químico → tanque + fuel; se iônico → recarga suficiente.
4. **Energia contínua:** Σgeração_contínua ≥ Σconsumo_contínuo.
5. **Bateria cobre combate:** output_máx ≥ dreno de combate; carga ≥ pico de combate.
6. **Vida:** suporte ativo se houver blocos pressurizados (senão só a cápsula
   temporária da ponte).
7. **Estrutura:** Σcusto_estrutura ≤ orçamento da ponte.

Motor iônico dispensa tanque mas exige geração contínua séria (reator, não só
painéis — painel solar sozinho não sustenta iônico). A obrigatoriedade muda com a
arquitetura.

### 10.1 Achados do teste de montagem (rodada 1 de peças)
- **Classes emergem corretas:** builds testadas foram classificadas certo (Fighter,
  Cargueira, Transporte) só pela proporção de estrutura, sem menu.
- **Anti-canivete funciona por MEDIOCRIDADE, não bloqueio.** A nave-que-faz-tudo é
  *montável* mas fica a mais pesada, MOB no fundo, estrutura quase estourada, sem
  margem — pior que qualquer nave especializada no que ela tenta fazer. Decisão de
  design: isto é o correto. Não proibir o canivete; fazê-lo medíocre. O jogador pode
  fazer tudo-mal (flexibilidade válida); não pode fazer tudo-bem.
- **Energia de cruzeiro vs combate** teve que ser separada, senão fighters legítimos
  (laser+escudo) ficavam inviáveis. Ver acima.
- **PENDENTE:** motor iônico + só painéis solares não fecha energia contínua. Definir
  se é intencional (iônico = build avançada que exige reator) ou se painel sobe.

---

## 11. PARÂMETROS CALCULADOS (mostrar na montagem)

Ao montar, exibir em tempo real:
- MOB (e classe de velocidade estimada)
- Autonomia (quantas unidades de distância com o fuel/carga atual)
- Consumo de energia vs geração (verde/vermelho)
- Output de bateria vs consumo ativo (verde/vermelho)
- Capacidade de carga / passageiros
- PDF, BLI, ESC, SEN, HP total
- Orçamento de estrutura usado / total
- Massa total
- **Classe derivada** (§classes no escopo)
- Avisos de inviabilidade (o que falta pra voar)

---

## 12. A DEFINIR / TESTAR
- Fator exato de `custo_estrutura` por tier (quão mais compacto é o tier alto?).
- Curva de `massa por unidade de fuel` (fuel pesado o suficiente pra importar?).
- Se reator nuclear entra na v0.1 ou fica pra fase 2 (adiciona insumo novo).
- Valores de bônus de classe SE forem mecânicos (por ora cosméticos).
- Tempo de sobrevivência da cápsula de emergência da ponte (janela de resgate).

---

## 13. Posicionamento tático no combate (IDEIA FORTE — recomendada para v0.2)

**A ideia (do usuário):** a disposição das peças influencia o combate. Peças
expostas (na borda) tomam dano primeiro; o núcleo (ponte, motor) fica protegido se
cercado por blindagem; armas mal posicionadas rendem menos. Layout deixa de ser só
estético e vira **engenharia de sobrevivência**.

**Por que é boa:** dá propósito mecânico ao layout (hoje é estético + coesão). Faz
"proteja o núcleo, blinde o exterior" uma decisão real. Casa com combate não-mortal
(inimigo destrói peças), dano por peça (cada bloco já tem HP) e relatório narrado
("o pirata rompeu tua blindagem lateral e atingiu o motor").

**Por que NÃO na v0.1 — achado de teste:** simulada em 3 variações, a mecânica se
mostrou **muito mais difícil de balancear do que parece**. Em todas, a nave mais
blindada sobrevivia mais rounds, e como o combate não-mortal encerra por % de HP,
mais rounds = mais tiros = mais chance do núcleo cair mesmo assim. Resultado
contraintuitivo: mal calibrada, a exposição pune QUEM investe em blindagem — o
oposto do pretendido. Nem revisando o modelo (dano direcional atravessando camadas)
consertou de imediato.

Conclusão: é um **sistema profundo que exige uma rodada de design dedicada**, não um
ajuste rápido. Risco alto de contaminar o combate (sistema central) se entrar mal
calibrado. E complica o "modo auto" (como auto-arranjar protegendo o núcleo?).

**Plano:** v0.1 mantém combate por atributos (validado); layout é estético + coesão.
v0.2 introduz posicionamento tático como profundidade nova — dá aos jogadores
existentes razão para repensar naves (ouro de retenção). Quando for feito, precisa
de: regra de exposição/camadas bem calibrada, arcos de tiro (opcional), e integração
com o modo auto.
