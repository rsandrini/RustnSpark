# Economia — Preços Dinâmicos por Local (v0.1)

> Como preços de combustível, reparo e peças variam por local. Modelo em camadas,
> com decisão explícita de escopo: **estático na v0.1, dinâmico na fase 2.**

---

## 1. O princípio

Preço não é global — varia por **onde** você está. Isso transforma reabastecer,
reparar e comprar de taxas fixas em **decisões geográficas**. "Encho aqui na
fronteira (caro) ou aguento até a base (barato, mas o desvio custa fuel e tempo)?"

Fórmula:
```
preço_final = preço_base × mod_isolamento × mod_facção × mod_oferta_procura
```

---

## 2. As três camadas (naturezas MUITO diferentes)

### 2.1 Isolamento — estático, TRIVIAL (v0.1)
Propriedade fixa do local (nível 0=hub central … 3=fronteira remota). Definida no
admin, nunca muda. Lugar remoto cobra mais (custa levar suprimento até lá).

| Nível | Multiplicador |
|---|---|
| 0 hub central | 0,9 |
| 1 central | 1,0 |
| 2 afastado | 1,4 |
| 3 fronteira remota | 2,0 |

### 2.2 Facção — estático, TRIVIAL (v0.1)
Multiplicador pela relação com o dono do local. Amarra no sistema de facção que já
existe.

| Relação | Multiplicador |
|---|---|
| aliado | 0,8 (preço de amigo) |
| neutro | 1,0 |
| hostil | 2,5 (mercado negro, ou não vende) |

### 2.3 "Humor" fixo do local — estático, TRIVIAL (v0.1)
Cada local sorteia uma variação fixa (0,85–1,15) **uma vez, na criação**, com
semente fixa. Dá a *sensação* de preços variando por lugar sem simular economia. O
jogador percebe "aquela estação sempre teve fuel barato" — indistinguível de
economia real para quem joga. Ilusão honesta e barata.

### 2.4 Oferta/procura — DINÂMICO, é uma fera (FASE 2)
Estoque simulado que sobe/desce conforme jogadores compram e vendem, com locais
produzindo e consumindo ao longo do tempo. **Exige o mundo proativo (jobs) e massa
de jogadores** — com poucos jogadores, o estoque mal se move e o "dinâmico" é ruído.
É o mesmo adiamento do mundo vivo. Fórmula quando entrar:
```
mod_oferta = clamp(1 / estoque_ratio, 0.6, 2.0)   # escasso encarece, abundante barateia
```

**Decisão de escopo:** v0.1 usa 2.1 + 2.2 + 2.3 (tudo estático). Já entrega ~90% da
sensação e a decisão geográfica completa. 2.4 entra na fase 2 junto do mundo vivo.

---

## 3. Preços resultantes na v0.1 (exemplo, tanque de 1.000)

| Local | fuel/un | tanque cheio | reparo/HP |
|---|---|---|---|
| Hub base (aliado) | 0,31 | ~306¢ | 2,4 |
| Estação central (neutro) | 0,51 | ~510¢ | 4,1 |
| Remota aliada | 0,52 | ~521¢ | 4,2 |
| Fronteira (neutro) | 1,13 | ~1.130¢ | 9,0 |
| Posto hostil | 1,91 | ~1.908¢ | 15,3 |

**~6x de variação** entre o mais barato e o mais caro. Decisão geográfica real.

O mesmo modelo se aplica a **compra e venda de peças**: comprar peça em local
escasso é caro; **vender loot em local escasso rende mais** (o gancho de comércio —
comprar barato num lugar, vender caro noutro, é uma profissão futura).

---

## 4. Preços-base (após reescala — a calibrar)

| Item | Preço-base |
|---|---|
| Combustível | 0,5 / unidade (SUBIR — margens ficaram gordas; ver §5) |
| Reparo | 4 / HP |
| Peça comum | 100¢ |
| Peça incomum | 300¢ |
| Peça rara | 800¢ |
| Peça épica | 2.000¢ |
| Peça lendária | 5.000¢ |

Recompensa de missão (reescalada): `D×0,8 + P×40 + bônus_tipo`.

---

## 5. PENDENTE de calibragem (próxima rodada)

- **Preço do combustível está baixo demais** relativo à recompensa (margens gordas
  demais após a reescala de números). Subir o preço-base de fuel para devolver
  tensão econômica — encher o cargueiro (tanque 3.000) deve doer contra a margem.
- **Curva de progressão:** simular 20–30 turnos e medir quantas missões até trocar
  de nave / comprar peça significativa. Alvo: progressão gostosa, nem trivial nem
  grind.
- **Custo de reparo vs comprar nova:** quando vale reparar vs substituir a peça?
- **Venda de loot:** preço de venda (fração do preço de compra) por local.
- **Balancear os multiplicadores** contra a margem real das missões (hostil 2,5x
  pode ser punitivo demais ou não).

---

## 6. Curva de progressão (validada em simulação)

Simulação de "vida do jogador" com TODOS os sistemas ativos (recompensa magra,
desgaste, falhas <50%, manutenção moderada, combate não-mortal, missões variadas
estilo Euro Truck).

### Descoberta-chave: recompensa TEM que escalar com o tier da nave
Primeira simulação travou (recompensa fixa ~300, custos de upgrade exponenciais →
estagnação após tier 2). **Correção:** nave de tier maior desbloqueia missões
melhores. `recompensa_base = 250 + tier×180`, modulada por distância, perigo e
performance (condição). Ganhos crescem com custos → curva saudável.

### Custos de upgrade (degraus) e curva resultante
| Tier | Custo | Missões p/ alcançar | ~Tempo idle (15min/missão) |
|---|---|---|---|
| 2 | 2.500 | 5 | ~1h |
| 3 | 7.000 | 18 (+13) | ~4h |
| 4 | 16.000 | 48 (+30) | ~12h |
| 5 | 32.000 | >400 (endgame de longo prazo) | 100h+ |

**Forma da curva:** acelera no início (1º upgrade em ~1h → engajamento), degraus
crescentes mas alcançáveis até tier 4 (retenção de médio prazo). Tier 5 é o
troféu de longuíssimo prazo.

### Decisão de intenção (do usuário)
Quão longo deve ser o endgame? Tier 5 em >400 missões é escolha de design válida
(objetivo de meses, retenção longa). Se quiser alcançável em tempo razoável, baixar
o custo do tier 5. — A DEFINIR.

### Ritmo confirmado
- Começo rápido (engaja): 1º upgrade em ~5 missões.
- Meio sustentado: degraus de 13 e 30 missões.
- Manutenção constante ao fundo (reparos a cada ~7 missões na estratégia moderada).
- Recompensas magras + desgaste como dreno = cada missão tem peso econômico.

---

## 7. Relatório de missão NARRADO (estilo RPG de texto)

**Princípio:** no jogo assíncrono, o jogador não assiste ao combate — **o relatório
É a experiência.** Deve ser narrado como um RPG de texto, não uma tabela de números.
Cada missão vira uma história curta. Bônus: torna os testes legíveis (dá pra ler e
julgar se foi justo).

Exemplo de formato:
```
--- Relatório: Entrega para Estação Ceres (rota média, perigo 5) ---
Partida às 14:02. Combustível: 82%.
A meio caminho, sensores detectaram uma assinatura hostil aproximando-se.
Corveta pirata da facção do Cinturão, transponder falsificado.
Tentativa de fuga: teus motores (MOB 4) contra os dele (MOB 6)... FALHOU.
Combate iniciado.
  Round 1: pirata acerta o flanco, escudo absorve (escudo 60%→30%).
  Round 2: teu canhão balístico atinge o motor dele (dano 34).
  Round 3: escudo cede; casco atingido (HP 280→240).
  Round 4: teu disparo crítico rompe a ponte inimiga.
Pirata derrotado (recuou a 18% de casco). Recuperaste 2 caixas de carga.
Chegada a Ceres às 14:47. Recompensa: +410 cr. Desgaste: −8% (casco, motor).
```

Aplica-se a TODOS os eventos: falha de peça ("O motor engasgou a meio caminho —
combustível queimando sem empuxo; tiveste de abortar"), vazamento, emboscada por
estar cego (sensor falho), fuga bem-sucedida, etc. Cada resultado mecânico tem sua
frase narrada. O motor de simulação já produz esses eventos; a camada de narração
os traduz em texto.

---

## 8. NÚMEROS CONVERGIDOS (sweep de 17 milhões de vidas)

Varredura de 8.748 configs × 2.000 vidas. Onde os 100 melhores configs concentram
cada parâmetro (valores iniciais para o GDD):

| Parâmetro | Valor convergido | Confiança |
|---|---|---|
| **preco_reparo** | **6** ¢/HP | altíssima (100/100 dos melhores) |
| **rec_base** | **200** | alta (81/100) |
| **rec_por_tier** | **120** | alta (67/100) |
| **desg_base** | **(3,5)%** por missão | alta (80/100) |
| **desg_ambiente** | **1.2×** | média (54/100) |
| **manutencao_tier** | **100** ¢/tier | alta (66/100) |
| **preco_fuel** | **2–4** (tolera faixa) | o jogo funciona em qualquer valor da faixa |
| **reparo_limiar** | 35/45/55 indiferente | jogador tem liberdade de estilo |

### Dois problemas que o sweep EXPÔS (correção de modelo, não de número)
1. **Combate winrate nunca passa de 40%** (alvo era 45-60%; 0/8748 acertaram). O NPC
   do simulador integrado escala forte demais vs o jogador. O combate ENTRE builds
   está balanceado (torneio ~50%); o gerador de NPC é que precisa ser ancorado
   melhor. NÃO é problema do design de combate.
2. **Falência 0%, tier5 ~89%** — economia confortável demais. Esperado (endgame foi
   deixado "fácil pra testar"). Corrigir subindo custos de upgrade e confirmando o
   dreno de manutenção. Precisa de novo sweep FOCADO (grade pequena, minutos).

### Próximo passo
Corrigir NPC + custos de endgame no simulador; rodar sweep focado só nas dimensões
ainda abertas (custos de upgrade, escala de NPC), com os valores acima já travados.

---

## 9. NÚMEROS FINAIS (após correção de NPC e sweep focado)

Corrigido o gerador de NPC (estava forte demais). Winrate de combate subiu de ~40%
(travado) para **55-56%** — dentro do alvo. Combate validado também no simulador
integrado, não só no torneio.

**Config recomendado para a v0.1 (valores iniciais do GDD):**
| Parâmetro | Valor |
|---|---|
| preco_fuel | 3 |
| preco_reparo | 6 |
| rec_base | 200 |
| rec_por_tier | 120 |
| desg_base | (3,5)% por missão |
| desg_ambiente | 1.2× |
| manutencao_tier | 100–200 |
| custos_upgrade | {2:2500, 3:7000, 4:16000, 5:32000} |

**Resultado deste config:** falência 0%, winrate 55%, ritmo tier2 ~9 missões,
tier5 ~120-144 missões, engasgo baixo.

### O que fica DELIBERADAMENTE generoso (decisão do usuário)
- **Margem alta (~800) e tier5 ~99%.** É o "endgame fácil pra testar o conjunto"
  que o usuário pediu. Os marcos reais de progressão serão definidos JOGANDO. Apertar
  = subir custos de upgrade e manutenção; é tuning fino, não redesign.

### Conclusão da investigação econômica
O SISTEMA é são: ninguém quebra por acaso, combate é justo (~55%), ritmo inicial
engaja (~9 missões pro 1º upgrade), desgaste tem peso certo. Os números acima são
os valores iniciais; a curva final de progressão é tuning de lançamento. **Economia:
investigação concluída.**
