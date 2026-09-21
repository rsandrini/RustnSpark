# Mapa e Missões — Rust and Spark (v0.1)

> O mapa é pré-requisito das missões: define distâncias (tempo/combustível),
> ambientes (desgaste/perigo), locais (onde pegar/entregar/comprar/reparar) e zonas
> (segura vs fronteira). Escala v0.1: **um sistema contido, tudo se alcança.**

---

## 1. Estrutura do mapa

Um **grafo de nós (locais) ligados por rotas (arestas)**. Estilo starmap de
navegação — nós são pontos, rotas são linhas, a nave é um ponto percorrendo a linha.

### 1.1 Nós (locais)
Cada local tem: nome, tipo, posição (x,y para desenhar), zona (0=centro seguro …
3=fronteira), facção dona, e os campos de estado do "mundo vivo" (necessidades,
prosperidade — estáticos na v0.1, ganchos pra fase 2).

Tipos de local:
- **Porto/Estação** — comprar, vender, reparar, pegar/entregar missões, passageiros.
- **Planeta** — igual + mais opções (superfície, mais missões).
- **Campo de sucata/destroços** — scavenging; ponto de missões de mineração/resgate.
- **Posto de fronteira** — serviços caros, mercado negro, missões arriscadas.

### 1.2 Rotas (arestas)
Cada rota liga dois nós e tem: **distância** (define tempo e combustível),
**perigo** (0-10, chance de encontro), e **ambiente** (o que desgasta — ver §2).
Uma rota pode ter mais de um ambiente (ex.: longa e radioativa).

### 1.3 Zonas (anéis concêntricos)
- **Centro (zona 0-1):** seguro, sem PvP, serviços baratos, missões que pagam pouco.
- **Meio (zona 2):** perigo moderado, melhor pagamento.
- **Fronteira (zona 3):** PvP livre, ambientes hostis, melhor loot e pagamento,
  serviços caros. O "Cinturão".

O jogador controla o próprio risco escolhendo até onde vai.

---

## 2. Ambientes (o que desgasta e como)

Cada ambiente estressa um subsistema diferente — dá razão pra montar a nave certa
pra rota certa. Amarra no sistema de desgaste (desgaste-e-manutencao-v0.1.md).

| Ambiente | Efeito | Peça que mitiga |
|---|---|---|
| **Espaço aberto** | Desgaste base baixo | — |
| **Campo de radiação** | Desgaste em eletrônicos (sensores, ponte, bateria) | Blindagem/casco |
| **Cinturão de detritos** | Dano físico ao casco; risco de impacto | Blindagem, escudo |
| **Tempestade solar** | Sobrecarrega energia; estressa baterias/reatores | Dissipação/escudo |
| **Poço gravitacional** | Consome mais combustível (mais empuxo) | Motor forte |
| **Vácuo profundo (fronteira)** | Isolamento: sem resgate fácil, tudo desgasta um pouco mais | Autonomia (tanque/O₂) |

Na v0.1 pode começar com 3-4 ambientes (aberto, radiação, detritos, gravitacional) e
expandir. Cada rota carrega 1-2 ambientes.

---

## 3. Tipos de missão (v0.1)

Cada tipo exige config de nave diferente e usa o mapa de um jeito distinto.

### 3.1 Entrega (carga)
Leva carga de A a B. Precisa de: espaço de carga (tipo certo — normal/refrigerada/
blindada). Resolve: viagem A→B, encontros na rota. Paga por distância+perigo+tipo de
carga. Volta opcional (pode pegar outra missão em B).

### 3.2 Transporte (pessoas)
Igual entrega, mas carga = passageiros. Precisa: cabine pressurizada + suporte de
vida. Risco extra: se a nave é destruída/decompressão, perde passageiros (falha
grave). Paga melhor que carga comum.

### 3.3 Escolta
Acompanha OUTRA nave (NPC) de A a B, defendendo-a. Precisa: armas + mobilidade.
Fluxo: talvez ir primeiro ao ponto A encontrar a nave, depois viajar até B juntos.
Combate provável (a escolta é atacada). Sucesso = nave protegida chega. Volta
opcional. Paga por perigo da rota + combate.

### 3.4 Mineração
Vai a um ponto X (campo/asteroide), coleta Y de material. Precisa: equipamento de
mineração + carga. **Chance Z% de achar material** por tentativa, escalando com
riqueza do ambiente e raridade do material. Dois modos:
- **Contratada:** "traga Y de material Z" → paga fixo.
- **Livre:** minera o que quiser e vende por conta (preço por local — economia).

### 3.5 Resgate
Vai a um local (destroço, nave em perigo), pega o alvo (carga, pessoas, peças),
traz de volta. Precisa: espaço adequado ao que resgata + às vezes velocidade
(resgate tem prazo — "chegar antes do ar acabar"). Paga bem, urgência alta.

### 3.6 Requisitos → amarra na montagem
| Missão | Exige na nave |
|---|---|
| Entrega | carga (tipo certo) |
| Transporte | cabine pressurizada + suporte de vida |
| Escolta | armas + mobilidade |
| Mineração | equip. mineração + carga |
| Resgate | espaço p/ o alvo + (às vezes) velocidade |

A nave que você monta determina que missões pode pegar → identidade emergente.

---

## 4. Geração de missões (template + contexto)

Missões geradas por template preenchido com dados reais do mapa:
- tipo · origem/destino (nós reais) · facção emissora · carga/alvo específico ·
  recompensa (faixa por distância+perigo+tipo) · duração/expiração · ambiente das
  rotas envolvidas · política de encontro.

Modelo Euro Truck: quadro de missões em cada local, sempre com opções, expiram e
renovam. O jogador escolhe pelo que a nave dele aguenta e pelo risco/retorno.

---

## 5. A DEFINIR (antes/durante o simulador)
- Tamanho do mapa inicial (quantos nós? sugestão: 8-15 pra v0.1).
- Distâncias concretas entre nós (alimentam tempo/combustível).
- Quantos ambientes na v0.1 (sugestão: 4).
- Fórmula de chance de mineração (riqueza do ambiente × raridade do material).
- Prazo/urgência do resgate (quão apertado).
