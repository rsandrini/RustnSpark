# Missões Compostas e Reabastecimento em Pernas — Rust and Spark (v0.2)

> Escopo: **v0.2**. Especificação de design para duas mecânicas que enriquecem o
> planejamento de rotas e a identidade das naves: (1) reabastecer em portos ao longo
> das pernas de uma missão, e (2) carregar até duas missões simultâneas quando a
> rota e a capacidade permitirem.
>
> O GDD v0.1 permanece travado; este documento é a base de design para a próxima
> fase.

---

## 1. Decisões de design consolidadas

- **Escopo:** v0.2 — não entra no MVP v0.1.
- **Reabastecimento:** somente em **portos** (locais do tipo `porto`, `planeta` ou
  `posto_fronteira` com serviço de combustível).
- **Modos de planejamento:** o jogador pode **planejar manualmente** as paradas ou
  **deixar o sistema sugerir automaticamente**.
- **Manual:** o jogador vê o preço do fuel em cada porto ao longo da rota e escolhe
  quanto abastecer em cada parada (dentro do limite do tanque).
- **Tempo:** cada parada de reabastecimento **aumenta o tempo total da missão**.
- **Tanque:** o tanque passa a ser o limite de **alcance entre dois portos**, não o
  alcance total da missão. Isso permite aumentar as distâncias no mapa sem exigir
  tanques gigantes.
- **Capacidade de carga/passageiros:** **permanece como na v0.1** — passageiros
  ocupam cabine pressurizada com suporte de vida; carga ocupa espaço de carga.
  Nenhuma conversão entre os dois.
- **Conflitos de política:** haverá uma **matriz de compatibilidade** entre tipos de
  missão. Algumas combinações são bloqueadas (ex.: transporte de pessoas + escolta).

---

## 2. Reabastecimento em pernas (Refuel on Legs)

### 2.1 Conceito

Uma missão/viagem pode ter **paradas intermediárias em portos** para reabastecer.
O combustível passa a ser um recurso de planejamento de rota, não apenas uma taxa
paga no início da viagem.

### 2.2 Onde é possível reabastecer

Somente em locais que ofereçam combustível (`servicos.combustivel = true`):
- **Porto/Estação**
- **Planeta**
- **Posto de fronteira** (preços mais altos, risco maior)

Campos de sucata, asteroides de mineração e destroços **não** vendem combustível.

### 2.3 Planejamento de paradas

Ao aceitar uma missão (ou um pacote de missões), o jogador entra na tela de
**planejamento de rota**. Nela pode:

1. **Modo automático:** o sistema sugere paradas otimizadas segundo uma estratégia
   escolhida:
   - **Menor custo:** compra o mínimo necessário nos portos mais baratos.
   - **Menor tempo:** minimiza o número de paradas (abastece mais quando para).
   - **Maior segurança:** evita paradas em zonas de alto perigo, mesmo que mais caro.
   - **Tanque cheio em toda parada.**

2. **Modo manual:** o jogador clica em cada porto ao longo da rota e define
   quanto combustível comprar (0 até a capacidade do tanque). O sistema mostra:
   - preço local do fuel (`preco_fuel × mod_isolamento × mod_facção × humor_preco`);
   - quanto já existe no tanque na chegada;
   - quanto é necessário para completar o próximo trecho;
   - custo total da parada;
   - tempo adicionado pela parada.

### 2.4 Impacto no tempo de missão

Cada parada adiciona um tempo fixo de escala:

```
tempo_parada = k_porto  (configurável por tipo de local)
```

Sugestão inicial:
- Hub grande: 30 s
- Porto médio: 60 s
- Posto de fronteira: 90 s

O tempo total da missão passa a ser:

```
tempo_total = Σ(tempo_de_viagem_por_perna) + Σ(tempo_parada)
```

> Nota: o tempo de abastecimento em si é considerado instantâneo (pagou, encheu),
> mas a **escala** (atracar, liberar, negociar) leva tempo.

### 2.5 Tanque como limite de alcance entre portos

O tanque não precisa mais armazenar combustível para a missão inteira. A nova
regra de viabilidade:

> Para cada trecho **porto → porto** sem parada intermediária, o combustível
> necessário deve caber no tanque.

Isso permite:
- **Aumentar distâncias no mapa:** rotas longas entre portos raros são viáveis
  desde que haja portos no meio do caminho.
- **Diversidade de builds:** naves com tanques pequenos viram “regionais” (rápidas,
  baratas, de curto alcance); naves com tanques grandes viram “interplanetárias”
  (pesadas, caras, autônomas).
- **Decisão real de massa:** tanque grande = autonomia, mas massa alta → MOB baixa
  → mais lenta e vulnerável.

### 2.6 Validação de viabilidade

Uma missão (ou pacote) só pode ser aceita se:

1. A nave tem tanque + fuel suficiente para o **primeiro trecho** (considerando o
   combustível atual no tanque).
2. Existe uma cadeia de portos ao longo da rota que permita chegar ao destino sem
   ficar sem combustível.
3. O jogador tem créditos suficiente para pagar o combustível planejado (ou aceita
   o risco de ficar negativo? — ver §5.1).

Se inviável, o botão “Aceitar” fica desabilitado com a razão:
- “Tanque pequeno demais para o trecho X→Y.”
- “Nenhum porto com combustível no caminho entre X e Y.”
- “Créditos insuficientes para o combustível planejado.”

### 2.7 Execução durante a missão

- Quando a nave chega a um porto com parada programada, o servidor aplica:
  - compra do combustível;
  - débito de créditos;
  - avanço do tempo da missão pelo `tempo_parada`;
  - geração de evento de escala no `MissionLog`.
- Se o jogador cancelou a missão ou a nave foi derrotada antes da parada, nada é
  comprado.
- O jogador pode **abortar** a missão a qualquer momento; combustível já comprado
  permanece no tanque.

### 2.8 UI/UX

- **No mapa:** a rota desenhada mostra pequenos ícones de combustível nos portos
  de parada.
- **Painel de planejamento:** lista as paradas com preço, quantidade, custo e
  tempo.
- **Slider por parada:** 0 a `capacidade_do_tanque - combustível_atual`.
- **Indicadores de alcance:** um círculo ou sombreado mostrando até onde a nave
  pode ir com o fuel atual sem parar.

---

## 3. Missões compostas (Mission Bundling)

### 3.1 Conceito

Uma nave pode embarcar **até duas missões simultâneas** desde que:
- as rotas se sobreponham (mesma origem/destino ou trecho compartilhado);
- a nave tenha capacidade para ambos os objetos;
- os tipos sejam compatíveis segundo a matriz de missões;
- o jogador aceite a política de encontro resultante.

> Início conservador: na v0.2, permitir **no máximo 2 missões por pacote**. Expandir
> para 3+ só após validação de economia e UI.

### 3.2 Regras de agrupamento

Para duas missões serem “bundleable”:

1. **Rota compatível:**
   - Versão MVP: **mesma origem e mesmo destino** (`A → B`).
   - Extensão futura: o trecho compartilhado representa ≥ 70% da distância total de
     ambas.

2. **Capacidade compatível:**
   - Soma das cargas ≤ `CRG` da nave.
   - Soma dos passageiros ≤ capacidade pressurizada da nave.
   - Missões que exigem espaço especial (refrigerada, blindada) precisam desse
     tipo específico de carga.

3. **Compatibilidade de tipo:** ver matriz no §3.3.

4. **Prazo compatível:** a missão mais curta não pode expirar antes da conclusão
   do pacote.

### 3.3 Matriz de compatibilidade

|                    | Entrega | Transporte | Escolta | Mineração | Resgate |
|--------------------|:-------:|:----------:|:-------:|:---------:|:-------:|
| **Entrega**        |   ✅    |     ✅     |   ⚠️*   |    ❌     |   ❌    |
| **Transporte**     |   ✅    |     ✅     |   ❌    |    ❌     |   ❌    |
| **Escolta**        |   ⚠️*   |     ❌     |   ❌    |    ❌     |   ❌    |
| **Mineração**      |   ❌    |     ❌     |   ❌    |    ❌     |   ❌    |
| **Resgate**        |   ❌    |     ❌     |   ❌    |    ❌     |   ❌    |

Legenda:
- ✅ Permitido.
- ⚠️* Permitido, mas com **conflito de política** resolvido pela regra de prioridade.
- ❌ Bloqueado.

#### Raciocínio por combinação

- **Entrega + Entrega:** transporte de múltiplas cargas. Clássico.
- **Entrega + Transporte:** nave cargueira de passageiros (ônibus espacial). A
  combinação mais óbvia e desejada.
- **Entrega + Escolta (⚠️):** uma nave armada pode proteger um cliente enquanto
  leva carga. **A política de escolta (lutar) domina.** O risco é que a carga
  própria pode ser danificada no combate. Pode ser desabilitado se o jogo
  considerar inaceitável colocar carga de terceiros em risco de propósito.
- **Transporte + Escolta (❌):** o usuário definiu como **NO-GO**. Passageiros
  civis não devem ser expostos intencionalmente a combate.
- **Mineração / Resgate:** não são missões de transporte ponto-a-ponto; envolvem
  paradas especiais (campo de mineração, destroço) e prazos apertados. Não
  entram no bundling da v0.2.
- **Escolta + Escolta:** duas naves-cliente simultâneas complicam demais o
  combate e a narrativa. Deixar fora do MVP.

### 3.4 Resolução de conflitos de política

Quando duas missões permitidas têm políticas diferentes, a seguinte prioridade
aplica (da mais restritiva para a menos restritiva):

1. **Escolta → LUTAR** (proteger o cliente é obrigatório)
2. **Transporte → FUGIR** (proteger passageiros)
3. **Entrega → FUGIR** (proteger carga)

Se ambas têm a mesma política, ela prevalece.

Exemplos:
- Entrega + Transporte → FUGIR.
- Entrega + Escolta → LUTAR (a carga fica exposta, mas o contrato de escolta
  manda).

### 3.5 Integridade do objeto e pagamento

Cada missão mantém sua própria **integridade do objeto** (0–100%).

Durante um evento compartilhado (combate, ambiente hostil):
- O dano ao objeto é calculado **independentemente para cada missão**.
- A proteção da nave (escudo/blindagem) aplica-se a ambos, mas o objeto de cada
  missão pode ter vulnerabilidades diferentes.

Exemplo: um raio solar atinge a nave. A carga refrigerada pode estragar por falha
elétrica; os passageiros podem ficar ilesos graças ao suporte de vida. Ambos os
valores de integridade são ajustados separadamente.

O pagamento segue a regra da v0.1 para cada missão:

```
prêmio_missão = base_missão × integridade_missão   (50% ≤ integridade ≤ 100%)
```

**Não há bônus de bundling.** O ganho já vem de completar duas missões em uma
viagem só (menos desgaste relativo, menos tempo total).

### 3.6 Execução e falha

- Se a nave é derrotada ou aborta, **ambas as missões falham** (ou ficam em
  estado de resgate, conforme regras da v0.1).
- Se uma missão falha por objeto destruído, a outra continua se ainda for
  viável (ex.: carga roubada, mas passageiros ainda podem ser entregues).
- Missões são registradas individualmente no histórico do jogador, mas aparecem
  agrupadas no relatório como um único “pacote”.

### 3.7 UI/UX

- **Quadro de missões:** missões bundleable ganham um ícone de “link” ou “combo”.
- **Ao clicar numa missão:** o sistema destaca no quadro as missões compatíveis.
- **Tela de confirmação do pacote:** mostra:
  - rota combinada;
  - uso de capacidade (carga/passageiros) em barras;
  - política de encontro resultante;
  - tempo total estimado incluindo paradas de combustível;
  - recompensa total potencial.
- **Relatório:** uma aba “Pacote” mostra o resumo das duas missões; cada missão
  mantém seu próprio log detalhado.

---

## 4. Mudanças no modelo de dados (sobre a v0.1)

### 4.1 `SHIP`

Adicionar relacionamento com múltiplas missões ativas:

```
# novo, substitui o conceito de uma única missão ativa:
active_missions : [FK -> mission_instance]  # max 2 na v0.2
```

Ou, preferencialmente, usar uma tabela de junção `SHIP_MISSION`:

```
ship_id     : FK -> ship
mission_id  : FK -> mission_instance
bundle_id   : FK -> mission_bundle
ordem       : int
```

### 4.2 `MISSION_BUNDLE` (nova entidade)

Representa o pacote de missões ativas em uma nave:

```
id           : uuid (PK)
ship_id      : FK -> ship
player_id    : FK -> player
mission_ids  : [FK -> mission_instance]
route_plan   : json  # plano de rota com pernas e paradas
status       : enum  # ativo | concluido | falha | abortado
started_at   : ts
```

### 4.3 `MISSION_INSTANCE`

Adicionar:

```
bundle_id    : FK -> mission_bundle (null se missão solitária)
object_integrity : num  # já existe, mas agora múltiplos por nave
```

### 4.4 Plano de rota (`route_plan`)

Estrutura sugerida para `MISSION_BUNDLE.route_plan`:

```json
{
  "legs": [
    {
      "index": 0,
      "from": "loc_A",
      "to": "loc_B",
      "route_id": "route_AB",
      "fuel_required": 450,
      "travel_time": 120,
      "refuel_stop": {
        "location_id": "loc_B",
        "fuel_added": 300,
        "price_per_unit": 3.5,
        "total_cost": 1050,
        "stop_time": 60
      },
      "missions_active": ["mission_1", "mission_2"]
    }
  ],
  "total_fuel_cost": 2100,
  "total_time": 540
}
```

### 4.5 `MISSION_LOG` / `MISSION_REPORT`

- Cada `MISSION_INSTANCE` mantém seu próprio log de eventos.
- Eventos compartilhados (combate, ambiente) são replicados em ambos os logs, mas
  com os efeitos específicos de cada objeto.
- Adicionar categoria de evento `escala` para paradas de reabastecimento.

### 4.6 `LOCATION`

Adicionar/confirmar:

```
servicos.combustivel : bool
```

Já existe no schema v0.1; garantir que seja usado na validação.

---

## 5. Balanceamento e tuning

### 5.1 Créditos negativos e combustível

- Se o jogador não tem créditos para o combustível planejado, o sistema pode:
  a) **bloquear** a aceitação; ou
  b) **permitir** e deixar o saldo negativo (consistente com a regra de resgate
     da v0.1, onde saldo negativo é possível).

> Recomendação: **bloquear** no planejamento automático, mas permitir no manual
> com aviso claro. O jogador pode querer apostar em encontrar créditos no
> caminho (vender sucata, etc.).

### 5.2 Economia do bundling

- **Sem bônus de combo.** O lucro extra vem da eficiência da viagem.
- **Massa acumulada:** dois objetos de missão adicionam massa (carga/passageiros)
  e reduzem a MOB. Isso já é uma penalidade natural.
- **Maior exposição a piratas:** uma nave com duas missões pode atrair mais
  atenção (aumentar chance de encontro em rotas de fronteira).
- Ajustar `rec_base`/`rec_por_tier` se a renda média por hora de jogo subir
  demais após playtest.

### 5.3 Combustível

- Ajustar `preco_fuel` e `fuel_use` para que o combustível continue sendo
  ~10% do custo de uma missão curta, mas chegue a ~25–30% em rotas longas com
  muitas paradas.
- Manter variação de preço por local para tornar o planejamento interessante.

### 5.4 Tempo de parada

- Começar conservador. O objetivo é que paradas sejam uma decisão, não uma
  punição.
- Ajustar `k_porto` conforme playtest.

---

## 6. Riscos e mitigações

| Risco | Mitigação |
|---|---|
| **UI fica complexa demais** | Começar com 2 missões máx. e rota idêntica. Usar abas e indicadores visuais claros. |
| **Economia inflaciona com bundling** | Sem bônus; massa e risco compensam; monitorar renda/h no admin. |
| **Combustível vira trivial** | Nem todo local vende combustível; preços variam; rotas secas existem. |
| **Relatório fica confuso com dois objetos** | Uma view “pacote” + views individuais por missão. |
| **Política de encontro inesperada** | Mostrar claramente na confirmação: “Esta viagem usará a política: LUTAR”. |
| **Validação de rota fica cara** | Calcular uma vez na aceitação; armazenar `route_plan`. Recalcular só se nave mudar. |

---

## 7. Decisões pendentes para fechar

1. **Tamanho máximo do pacote:** confirmar **2 missões** para v0.2.
2. **Entrega + Escolta:** manter como ⚠️ permitido (política de escolta vence) ou
   bloquear por completo?
3. **Sobreposição de rota:** começar apenas com **mesma origem/destino**, ou já
   permitir trecho compartilhado ≥ 70%?
4. **Modo automático padrão:** “menor custo” ou “menor tempo”?
5. **Créditos insuficientes:** bloquear aceitação ou permitir saldo negativo?

---

## 8. Checklist de implementação (resumo)

- [ ] Adicionar `MISSION_BUNDLE` ao schema.
- [ ] Alterar `SHIP`/`MISSION_INSTANCE` para suportar múltiplas missões ativas.
- [ ] Implementar validação de plano de rota com paradas de combustível.
- [ ] Implementar cálculo de tempo total incluindo escalas.
- [ ] Implementar matriz de compatibilidade e resolução de política.
- [ ] Atualizar UI do mapa com indicadores de alcance e paradas.
- [ ] Atualizar quadro de missões para destacar combos.
- [ ] Atualizar relatório com view de pacote.
- [ ] Adicionar parâmetros de tuning (`tempo_parada`, estratégias de auto-refuel)
  ao `GameConfig`.
- [ ] Simular economia com bundling + refuel para ajustar números.

---

*Documento v0.1 — criado para planejamento da fase 2. Atualizar conforme as
pendências do §7 forem decididas e a implementação avançar.*
