# Facções — Rust and Spark (v0.1)

> Esboço inicial. Três facções jogáveis (neutras entre si na v0.1) + piratas
> (inimigos de todos). Cada facção tem identidade que já sugere mecânica.

---

## 1. As três facções

### Luna — Terra e Lua
- **Cultura:** mercadores e exploradores. O interior civilizado e próspero.
- **Tom:** confortável, comercial, o "centro" do mundo conhecido.
- **Amarra mecânica:** oferece missões de comércio/entrega; melhores portos e preços;
  zona central mais segura. A facção de quem quer jogar logística.

### Sun — Marte e arredores
- **Cultura:** sobreviventes, militares, tecnológicos.
- **Tom:** duro, marcial, disciplinado.
- **Amarra mecânica:** missões de combate/escolta; acesso a tecnologia/peças
  melhores; postura mais agressiva. A facção de quem quer lutar.

### Explorers — estações de mineração distantes
- **Cultura:** "anões mineradores do espaço" — sobreviventes da fronteira, vivem em
  estações e bases ao redor de postos de mineração. Dispostos a usar equipamento
  velho.
- **Tom:** fronteiriço, engenhoso, "a sucata é honra".
- **Amarra mecânica:** É a cara do sistema de desgaste. Missões de mineração;
  mercado de peças usadas; a facção onde naves gastas são o padrão, não vergonha.
  A facção de quem quer sobreviver e prosperar na margem.

---

## 2. Piratas (não jogável)
- **Cultura:** caóticos, sobreviventes sem lei, bandidos.
- **Papel:** inimigos de TODOS. São o ambiente hostil, não uma facção jogável.
  Os NPCs de combate; a ameaça que justifica escolta, armamento e a tensão das rotas
  de fronteira. Roubam e destroem.

---

## 3. Matriz de relações (v0.1)

Simples de propósito: **todos neutros entre si, piratas hostis a todos.**

|            | Luna    | Sun     | Explorers | Piratas |
|------------|---------|---------|-----------|---------|
| **Luna**       | —       | neutro  | neutro    | inimigo |
| **Sun**        | neutro  | —       | neutro    | inimigo |
| **Explorers**  | neutro  | neutro  | —         | inimigo |
| **Piratas**    | inimigo | inimigo | inimigo   | —       |

Consequências na v0.1 (via sistema facção/postura/contexto já definido):
- Naves da mesma facção não se atacam.
- Naves de facções neutras se ignoram por padrão (a menos que postura/contexto mude).
- Piratas são hostis a qualquer jogador → combate/fuga.

Fase 2+: relações podem mudar (aliança, rivalidade, reputação individual do jogador
com cada facção), abrindo tensão política e o loop social de transponder/contrabando.

---

## 4. Escolha inicial do jogador (TRAVADO)
- **O jogador escolhe uma das três facções ao começar.** Define porto inicial,
  primeiras missões e tom.
- Sem troca de facção no MVP (fase 2 pode permitir).
- Viés inicial leve por facção (opcional, a testar): Luna = uns créditos a mais;
  Sun = uma peça de arma; Explorers = uma peça extra usada.

---

## 5. A detalhar depois
- Reputação individual com cada facção (fase 2).
- Territórios no mapa por facção (quais zonas/portos são de quem).
- Peças/tecnologia exclusivas por facção (Sun tech militar, Explorers peças usadas
  baratas, Luna bens de comércio).
- Nomes próprios de portos/personagens por facção (sabor).
