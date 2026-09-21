# Teste de Mesa — Jogo Idle Espacial v0.1

> Livro de regras jogável para testar o loop NO PAPEL antes de codar. Números
> **provisórios**: o objetivo é rodar turnos, ver onde dói, e ajustar. Resolve-se
> tudo com **1d20** (rolagem + modificador vs DC), fiel à fundação RPG.

---

## 0. Propósito e premissas (o que este teste É e o que NÃO é)

**Para que serve:**
- Validar o **balanceamento de sistema** (fuel, risco, recompensa, combate) com
  números concretos.
- Sentir a **forma do loop** (viagem → encontro → combate → economia) antes de codar.
- Responder perguntas iniciais: a nave é fraca demais? fugir na proporção certa? o
  risco cria decisão? o combate dura o número certo de rounds?
- Ter "alguma coisa" concreta — a ficha, as fórmulas — como base dos testes mais
  profundos.

**Para que NÃO serve:**
- Não prova que o jogo é **divertido** — isso só com pessoas jogando.
- Não valida UX, ritmo idle real (tempo de espera), nem sensação de progressão de
  longo prazo.
- Os números são chutes calibrados, não verdade final.

**Regenerável:** todas as fórmulas e parâmetros estão neste doc; o simulador é
reconstruível a partir das seções 3–6. Após cada mudança, re-rodar e comparar com o
log (seção 9).

---

## 1. A ficha — tudo que luta é uma ficha

Princípio de arquitetura: **jogador e NPC são a MESMA estrutura de dados.** Uma
ficha do jogador é montada por ele; uma ficha de NPC é preenchida por um gerador
(com um "orçamento de pontos" que escala a dificuldade). Um único motor de combate
resolve jogador×NPC e jogador×jogador. NPCs são "naves montadas" — por isso o loot
faz sentido (dropam as peças que tinham).

Atributos (escala 0–20; ~5 básico, ~15 excelente). **Todos derivam das peças** —
não são digitados à mão:

| Atributo | O que faz | Deriva de |
|---|---|---|
| **Mobilidade (MOB)** | Velocidade de viagem e fuga | potência dos motores ÷ massa total |
| **Poder de Fogo (PDF)** | Dano em combate | armas |
| **Blindagem (BLI)** | Dificulta o acerto (DC de defesa) | casco/placas |
| **Escudo (ESC)** | Absorve dano antes do HP; regenera | escudos + energia |
| **Sensores (SEN)** | Detecta antes, iniciativa, evita emboscada | radar/sensores |
| **Carga (CRG)** | Espaço útil | blocos de carga |
| **Casco (HPmax)** | Vida total | soma dos blocos |

Estoques (não são atributos): **Combustível (FUEL)**, **Créditos (¢)**,
**Munição/mísseis**.

---

## 2. Peças têm atributos — a ficha é a SOMA delas

O teste não trata PDF/BLI/MOB como números caídos do céu: eles **vêm das peças**.
Cada peça carrega seus próprios atributos, e a ficha é o agregado. Isso é o que cria
o balanceamento emergente.

### 2.1 Motores (exemplo detalhado — o modelo vale para todas as peças)

Motor tem: **potência**, **massa** (o próprio motor pesa), **consumo** (fuel/un),
**tipo de energia** (líquido / bateria).

```
MOB   = round( (soma potência motores) / (massa total da nave) × 1.6 )
consumo total = soma dos consumos dos motores
```

Resultado (mesma nave, trocando só o motor):

| Motor | Potência | Massa | Consumo/un | MOB | Fuel p/ D=10 |
|---|---|---|---|---|---|
| Pequeno econômico | 25 | 3 | 0,7 | 3 | 7 |
| Médio balanceado | 40 | 6 | 1,2 | 4 | 12 |
| Grande potente | 70 | 14 | 2,5 | 5 | 25 |
| Enorme sedento | 110 | 26 | 4,5 | 5 | 45 |

**Não há motor dominante:** o Enorme dá MOB alta mas o tanque não aguenta o consumo
e a massa exige casco maior; o Pequeno é lento mas viaja barato e longe. A escolha
depende do papel da nave (cargueiro econômico vs interceptor sedento). Decisão real.

O mesmo princípio (peça → contribuição → agregado) vale para armas (PDF + tipo de
munição/energia), casco (BLI + HP + massa), escudo (ESC + consumo de energia),
sensores (SEN), carga (CRG + massa).

---

## 3. Nave inicial ("Sucateira") — versão calibrada

Montada de peças base; recebida de graça ao ser destruída.

- Motor médio: potência 40, massa 6, consumo 1,2
- Casco leve, ponte, suporte de vida, 1 canhão balístico, reator pequeno
- Massa total ~16

**Ficha:** MOB 4 · PDF 4 · BLI 3 · ESC 0 · SEN 1 · CRG 2 · HPmax 28
Estoques: FUEL 22 · Munição 10 · ¢200

---

## 4. VIAGEM

### 4.1 Consumo de combustível
```
FUEL gasto = D × consumo_total
```
(consumo_total vem dos motores; ver §2.1). Sucateira: 10 × 1,2 = 12 fuel para D=10.

### 4.2 Tempo e classe
```
Tempo (min) = D × 6 ÷ MOB
```
Cortes: <8 rápida · 8–20 média · >20 longa. Sucateira D=10 → 15 min → média.

### 4.3 Encontro na rota
Rota tem **perigo P** (0 seguro … 8+ fronteira).
```
Encontro se 1d20 ≤ P + (D÷5) − SEN
```
Sensores reduzem a chance de surpresa. Taxas observadas (Sucateira SEN 1, D=10):
segura P=3 ~20% · média P=6 ~37% · fronteira P=8 ~47%.

---

## 5. COMBATE (RPG, NÃO-MORTAL)

### 5.1 Combate termina por DERROTA, não por aniquilação
Encerra quando um lado cai a **≤20% do HPmax** (limiar de derrota) — não a zero.
Consequência: a maioria dos combates é perda/vitória **parcial**; destruição total
vira caso raro (só desequilíbrio extremo ou teimosia). Isso suaviza a punição e cria
um gradiente (perdi carga < perdi peça < perdi a nave).

### 5.2 Ataque
```
1d20 + PDF (atacante) vs DC = 10 + BLI (defensor) + (ESC>0 ? 3 : 0)
Dano no acerto = PDF + 1d6   (mísseis +2d6; laser ignora bônus de ESC)
```
Dano sai do Escudo primeiro, depois do HP. Escudo regenera +2/round se houver energia.

### 5.3 Iniciativa
Maior **SEN** ataca primeiro; empate → maior MOB.

### 5.4 Consequência por tipo de vencedor (o que "derrota" significa)
- **Pirata vence** → rouba carga e/ou créditos e/ou 1 peça; te deixa ir. Perde
  valor, não a nave.
- **Facção inimiga vence** → *desestabiliza*: destrói peça(s) específica(s), aborta
  tua missão e te força a **voltar pela rota de onde veio** (gasta fuel de volta,
  sem recompensa). Sabotagem, não pilhagem.
- **Destruição total (HP a 0 mesmo)** → caso raro; nave perdida, recomeço (ver §6.4).
- **Jogador vence** → loot conforme tabela (§6.3); se contra pirata, recupera o que
  seria roubado.

### 5.5 Resultados observados (500 combates, Sucateira calibrada, limiar 20%)
- vs Pirata (HP18): ~47% derrota parcial / ~53% vitória parcial.
- vs Facção (HP22, mais forte): ~74% derrota / ~26% vitória.
Quase ninguém é aniquilado — o combate virou "quanto perdi", não "morri?".

---

## 6. FUGA, COMPRA e ECONOMIA

### 6.1 Fuga (teste de RPG)
```
1d20 + MOB (foge) vs DC = 10 + MOB (perseguidor)
Sucesso → escapa sem dano. Falha → perseguidor ganha 1 ataque grátis; combate começa.
```
Sucateira (MOB 4) vs pirata (MOB 6): DC 16, precisa ≥12 (45%). Apertado de propósito.

### 6.2 Custo vs recompensa
```
Recompensa = D×8 + P×22 + bônus_tipo
Custo viagem = FUEL gasto × 3¢/un
Reparo = 5¢ por HP restaurado
```

### 6.3 Preços de peça e loot
| Tier | Compra | Sucata |
|---|---|---|
| Comum | 100¢ | 20¢ |
| Incomum | 300¢ | 60¢ |
| Rara | 800¢ | 180¢ |
| Épica | 2.000¢ | 500¢ |
| Lendária | 5.000¢ | 1.300¢ |

Drop (1d100) por fonte:
| Fonte | Nada | Comum | Incomum | Rara | Épica | Lendária |
|---|---|---|---|---|---|---|
| Scavenging | 30% | 45% | 20% | 5% | — | — |
| NPC comum | 20% | 40% | 28% | 10% | 2% | — |
| NPC elite | 10% | 25% | 35% | 22% | 7% | 1% |

### 6.4 Peso da morte — meio-termo assimétrico (DECISÃO A CONFIRMAR)
- Nave **base** barata de recuperar (nunca fica preso — espírito Euro Truck/cozy).
- **Peças raras instaladas** podem ser perdidas/danificadas na destruição total.
- O risco **escala com o investimento**: iniciante de sucata arrisca à vontade;
  veterano com nave cara sente o peso. Concilia cozy + Expanse.
- Como a destruição total agora é rara (§5.1), este dilema fica menos central: a
  punição normal é o gradiente carga→peça, não a morte.

---

## 7. FOLHA DE TURNO
1. Escolher missão (tipo, D, P, recompensa).
2. Checar viabilidade (fuel ida+volta? nave apta ao tipo?).
3. Viajar (fuel, tempo, rolar encontro).
4. Resolver encontro (árvore de comportamento → fuga/combate → consequência por tipo).
5. Completar missão (recompensa; registrar efeito no local — gancho mundo vivo).
6. Voltar / reabastecer / reparar / comprar.
7. Fechar o caixa (lucro? nave melhorou ou piorou?).

---

## 8. O QUE OBSERVAR
- Combustível: restrição interessante ou frustrante?
- Encontros: tensão ou irritação?
- Lucro/missão: progressão justa (nem trivial, nem lenta)?
- Fuga na proporção certa?
- Quantos turnos até a 1ª melhoria significativa?
- Combate: nº de rounds bom (nem anticlímax, nem tédio)?
- Cada tipo de derrota (pirata vs facção) tem textura diferente o suficiente?

---

## 9. LOG DE RODADAS

- **(rodada 1)** valores iniciais. Achados: nave inicial era armadilha (17–22%
  destruição, 1% vitória); perigo invertido (fronteira pagava mais sem punir);
  combate decidido antes de começar.

- **(rodada 2)** nave PDF3→4/BLI2→3/HP20→28/FUEL20→22; pirata HP25→18; recompensa
  P×15→P×22; morte custo real; loot vitória +120. Resultado: combate winnable (61%),
  curva de risco coerente. Pendente: fronteira ainda levemente ótima.

- **(rodada 3)** incorporados os 4 pontos do usuário:
  1. **Motores com atributos** (potência/massa/consumo) → MOB e consumo derivam.
     Validado: sem motor dominante, escolha depende do papel.
  2. **NPC = mesma ficha do jogador** (princípio registrado §1).
  3. **Combate não-mortal** (limiar de derrota 20%): destruição total virou rara;
     maioria dos combates é perda/vitória parcial. Consequência por tipo de vencedor
     (pirata pilha, facção desestabiliza+força retorno).
  4. Documentado propósito/premissas (§0) e tornado regenerável.
  Resultados: vs pirata ~47/53 derrota/vitória; vs facção ~74/26.

### Números vigentes (rodada 3)
- Nave inicial: MOB 4 · PDF 4 · BLI 3 · ESC 0 · SEN 1 · CRG 2 · HPmax 28 · FUEL 22 · ¢200
- Motor médio: potência 40 · massa 6 · consumo 1,2
- Pirata: MOB 6 · PDF 5 · BLI 3 · SEN 4 · HP 18
- Facção: MOB 5 · PDF 6 · BLI 4 · SEN 5 · HP 22
- MOB = round(potência ÷ massa_total × 1,6); consumo = Σ consumos
- Fuel = D × consumo · Tempo = D×6÷MOB · Encontro se d20 ≤ P + D/5 − SEN
- Ataque: d20+PDF vs 10+BLI(+3 se ESC>0); dano PDF+1d6
- Limiar de derrota: 20% HPmax
- Recompensa = D×8 + P×22 + bônus · fuel 3¢ · reparo 5¢/HP

---

## 10. AINDA A MODELAR (próximas rodadas)
- Consequências detalhadas: quanto/quais peças pirata rouba vs facção destrói.
- "Voltar pela rota" — custo de fuel e tempo do retorno forçado.
- Progressão: simular 20–30 turnos seguidos, ver curva de poder e ¢.
- Builds divergentes: nave de combate (PDF) vs fuga (MOB) vs carga (CRG).
- Escudo e regeneração no combate (ainda simplificado).
- Tipos de missão além de entrega (mineração, escolta, resgate) com suas fórmulas.
