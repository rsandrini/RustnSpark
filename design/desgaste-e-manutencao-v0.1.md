# Desgaste, Perigos e Manutenção (v0.1)

> Mudança de filosofia econômica: **desgaste é o dreno principal**, combustível vira
> tempero. Naves usadas viram o padrão. Validado em simulação — o sistema se
> auto-balanceia (sem estratégia dominante).

---

## 1. Filosofia — de onde o dinheiro sai

Antes o combustível carregava a "tensão econômica". Agora o peso se distribui melhor:

| Custo | Papel | Peso |
|---|---|---|
| **Combustível** | Recorrente pequeno, tempero. NUNCA impede navegar. | ~10% |
| **Desgaste / reparo** | O dreno PRINCIPAL. Constante, escala com o valor das peças. | ~35–40% |
| **Perigos ambientais** | FONTE de desgaste acelerado; dão textura ao mapa. | (via desgaste) |

Por que desgaste é melhor dreno que combustível: **escala com o sucesso.** Nave
melhor = peças mais caras se degradando = manutenção mais cara. Mantém o dinheiro
fluindo E com destino mesmo no late-game. Combustível não escala; desgaste sim.

Consequência de sabor: **naves usadas viram o padrão** (Expanse puro — ninguém no
Cinturão voa 0km). A decisão "peça usada barata mas gasta vs nova cara mas confiável"
passa a ser constante.

---

## 2. Condição da peça (0–100%) — degradação + FALHA abaixo de 50%

Cada peça tem **condição** que cai com o uso. Dois regimes:

**Acima de 50% — degradação suave.** Performance escala; a peça só fica pior.
```
performance = 0,5 + 0,5 × (condição / 100)
```
**Abaixo de 50% — zona de FALHA.** Além de degradada, a peça pode *falhar* durante a
missão, com consequência específica por tipo. Ritmo alvo: **meio pra hard.**

| Condição | Performance | Chance de falha/missão | Zona |
|---|---|---|---|
| ≥50% | 75–100% | 0% | seguro |
| 45% | 72% | ~1% | atenção |
| 40% | 70% | ~4% | atenção |
| 30% | 65% | ~16% | perigo |
| 20% | 60% | ~36% | perigo |
| 10% | 55% | ~64% | crítico |
| 0% | 50% | ~100% | crítico (sucata) |

Curva de falha: `((50−condição)/50)² × 1,0` (zero a 50%, acelera perto do fundo).

**Princípio de design — hard justo, não arbitrário:** a falha é previsível (o
jogador vê a condição e a chance) e evitável (é só reparar), mas evitar custa.
Ninguém falha por azar puro — falha porque *escolheu* esticar a nave. Voar
degradado é aposta consciente, não suicídio (dá pra esticar ~6 missões a partir de
45%, ~3 a partir de 25%).

### 2.1 Consequências de falha por tipo de peça
| Peça | O que acontece ao falhar |
|---|---|
| **Motor** | Perde empuxo: viagem falha OU gasta fuel sem gerar empuxo → missão abortada, volta |
| **Bateria** | Descarrega rápido: escudo/sistemas caem no meio do combate |
| **Tanque** | Vazamento: perde 30–50% do fuel restante na viagem |
| **Escudo** | Cai no combate: o próximo dano vai direto no HP |
| **Arma** | Trava: perde metade dos rounds de combate |
| **Sensor/radar** | Cego: não detecta encontro/perigo → emboscada garantida |

Efeitos de degradação (acima de 50%, sem falha ainda): motor mais lento + mais
consumo; painel gera menos; bateria menos carga e pior I/O; arma menos dano; casco/
escudo menos proteção.

---

## 3. Fontes de desgaste

```
desgaste_missão = base + ambiental + sobrecarga
```

- **Base** (uso normal): ~1–3% por missão.
- **Ambiental** (perigo da zona): perigo × 0,5–1,5. Radiação, micrometeoritos,
  tempestades, gravidade extrema. Independe de combate.
- **Sobrecarga** (forçar a peça): +8–15% num golpe. Sobrecarregar motor pra fugir,
  puxar mais energia que o output da bateria aguenta. Conecta com os perfis de
  energia (a "sobrecarga na fuga" ganha consequência real).

Durabilidade resultante (peça dura ~):
| Zona | Desgaste/missão | Dura ~ |
|---|---|---|
| Segura | 2% | 51 missões |
| Média | 5% | 20 missões |
| Perigosa | 8% | 13 missões |
| + sobrecarga pontual | +8–15% num golpe | — |

Mitigação: blindagem/escudo reduzem dano ambiental → a nave certa para a zona certa.

---

## 4. Perigos ambientais (novo eixo do mapa)

O mapa ganha perigo que NÃO é só inimigos. Uma rota pode ser perigosa pelo
**ambiente**: corrói peças, causa dano direto, estressa sistemas. Isso:
- Dá razão para blindagem/escudo além do combate.
- Torna "que nave para que rota" uma decisão.
- Cria zonas de alto-risco/alta-recompensa que não dependem de PvP.

Tipos (provisório): campo de radiação, cinturão de detritos, tempestade solar, poço
gravitacional. Cada um estressa um subsistema diferente (ideia a detalhar).

---

## 5. A decisão de manutenção (auto-balanceada — VALIDADO) + ritmo meio-hard

Ritmo definido: **meio pra hard** (nem cozy, nem hardcore). Simulação de 30 missões
com falhas ativas, 4 estratégias (400 amostras cada):

| Estratégia | Saldo médio | Falhas/30 | Pior saldo | Caráter |
|---|---|---|---|---|
| Conservador (repara a 60%) | ~6.664 | 0,0 | 6.380 | estável, reparo pesa |
| Moderado (repara a 45%) | ~6.306 | 0,0 | 5.589 | equilibrado |
| Arriscado (repara a 30%) | ~5.641 | 0,4 | 4.404 | lucrativo mas volátil |
| Sucateiro (nunca) | ~4.582 | 3,1 | 3.443 | espiral suave |

**Trade-off claro, sem estratégia dominante:**
- Conservador → estável, mas reparo constante come o lucro.
- Arriscado → maior teto em runs de sorte, mas "pior saldo" bem mais baixo
  (volatilidade real, não só média).
- Sucateiro → entra em espiral SUAVE (falha danifica → mais chance de falha), mas
  ~3 falhas em 30 missões, não colapso. Negligência se auto-pune sem morte
  instantânea.

Isto dá o "meio-hard": **erro custa, mas é recuperável.** A falha aborta a missão e
danifica; não destrói a nave. Mantém o dinheiro fluindo com destino (reparo perpétuo)
e cria decisão de risco recorrente.

---

## 6. Custo de reparo (aumentado)

```
custo_reparo = valor_da_peça × (% de condição perdida) × fator_local × 0,8
```
Reparo MAIS caro que antes (reforça naves usadas como padrão). Modulado por local
(caro na fronteira, barato na base — ver economia-v0.1.md).

Decisão paralela: às vezes **substituir** a peça (comprar usada mais barata) sai
melhor que reparar a atual. Peças usadas no mercado vêm com condição < 100% e preço
proporcional.

---

## 7. Resolvido nesta rodada / ainda a detalhar

**Resolvido:**
- Ritmo: **meio pra hard** (definido).
- Falha total: **existe, abaixo de 50%**, com curva previsível e consequência por
  tipo (§2, §2.1). Não é azar arbitrário — é aposta consciente.

**A detalhar:**
- Recompensas BAIXADAS (de ~660 para ~350 na média) — confirmar curva completa de
  progressão (quantas missões até trocar de nave, com falhas ativas).
- Detalhar cada perigo ambiental e que subsistema estressa.
- Mercado de peças usadas: como condição afeta preço de compra/venda (peças usadas
  baratas viram estratégia de reposição vs reparo).
- Como o aviso de risco é comunicado na UI (o jogador PRECISA ver a zona de falha
  claramente, senão a falha vira "injusta").
- Falha em cascata: limitar para não virar espiral da morte dura (hoje é suave —
  manter assim).

---

## 8. Decisões travadas (rodada de simulador integrado)

**Falha de peça — fórmula:**
- Degradação suave sempre (performance = 0,5 + 0,5×cond/100).
- **Engasgo abaixo de 30%**, crescendo exponencial até 1%: quanto pior, mais frequente.
  Fórmula sugerida: `chance_engasgo = ((30 − cond)/30)² ` para cond<30 (0 a ~1).
- **≤1% de condição: a peça não funciona** (morta até reparar).
- **Peças grátis iniciais já vêm USADAS (~80%)** — o jogador nasce com sucata, nunca
  0km. Reforça "naves usadas são o padrão".

**Endgame:** alcançável fácil por ora (testar o conjunto todo). Marcos reais de
progressão o usuário define jogando. Simulador não deve travar na curva.

**Escudo vs blindagem — papéis distintos (confirmado):**
- **Escudo:** toma o dano primeiro; o que passar vai pra blindagem (ou HP). Regenera
  por segundo, mas devagar e gastando energia. Papel: sustentação para quem luta
  muito e tem tempo entre combates.
- **Blindagem:** toma o dano antes do HP. NÃO regenera. Cara de trocar → compensa
  substituir. **Remendar é barato mas piora a peça** (decisão: remendo barato e placa
  pior, vs troca cara). Papel: absorção durável mas degradável.
