#!/usr/bin/env python3
"""
Simulador de teste de mesa — Jogo Idle Espacial v0.1
Regenerável: reflete as fórmulas do playtest-mesa-v0.1.md (rodada 3).
Uso:  python3 simulador-mesa.py
Ajuste os PARÂMETROS abaixo e re-rode para ver o impacto no balanceamento.
"""
import random

# ============ PARÂMETROS (edite e re-rode) ============
LIMIAR_DERROTA = 0.20          # combate encerra a esta fração do HPmax
PRECO_FUEL = 3                 # ¢ por unidade
PRECO_REPARO = 5              # ¢ por HP
REC_D = 8                      # peso da distância na recompensa
REC_P = 22                    # peso do perigo na recompensa
BONUS_TIPO = 20

NAVE_INICIAL = dict(MOB=4, PDF=4, BLI=3, ESC=0, SEN=1, CRG=2, HPmax=28,
                    FUEL_MAX=22, consumo=1.2)
PIRATA = dict(MOB=6, PDF=5, BLI=3, SEN=4, HPmax=18)
FACCAO = dict(MOB=5, PDF=6, BLI=4, SEN=5, HPmax=22)

# ============ MOTOR: MOB e consumo derivam ============
def ficha_de_motor(potencia, massa_motor, consumo, outras_massas=10):
    mt = massa_motor + outras_massas
    mob = max(1, round(potencia / mt * 1.6))
    return mob, consumo, mt

# ============ DADOS ============
def d(n=20): return random.randint(1, n)

# ============ COMBATE não-mortal ============
def ataque(pdf, bli, esc):
    if d(20) + pdf >= 10 + bli + (3 if esc > 0 else 0):
        return pdf + d(6)
    return 0

def combate(nave, inim):
    hp, ihp = nave['HPmax'], inim['HPmax']
    hp_min = nave['HPmax'] * LIMIAR_DERROTA
    ihp_min = inim['HPmax'] * LIMIAR_DERROTA
    rnd = 0
    while hp > hp_min and ihp > ihp_min and rnd < 15:
        rnd += 1
        if inim['SEN'] >= nave['SEN']:
            hp -= ataque(inim['PDF'], nave['BLI'], nave['ESC'])
            if hp > hp_min: ihp -= ataque(nave['PDF'], inim['BLI'], 0)
        else:
            ihp -= ataque(nave['PDF'], inim['BLI'], 0)
            if ihp > ihp_min: hp -= ataque(inim['PDF'], nave['BLI'], nave['ESC'])
    if hp <= hp_min and ihp <= ihp_min: return 'empate', hp, ihp, rnd
    if hp <= hp_min: return 'derrota', hp, ihp, rnd
    if ihp <= ihp_min: return 'vitoria', hp, ihp, rnd
    return 'inconclusivo', hp, ihp, rnd

# ============ FUGA ============
def fuga(nave, inim):
    return d(20) + nave['MOB'] >= 10 + inim['MOB']

# ============ TURNO (missão de entrega, tenta fugir) ============
def turno(nave, D, P, inim):
    fuel = round(D * nave['consumo'])
    if fuel > nave['FUEL_MAX']:
        return dict(resultado='sem_fuel', lucro=0, encontro=False)
    recompensa = D * REC_D + P * REC_P + BONUS_TIPO
    encontro = d(20) <= P + D // 5 - nave['SEN']
    hp_final = nave['HPmax']; res = 'limpa'
    if encontro:
        if fuga(nave, inim):
            res = 'fuga'
        else:
            r, hp_final, _, _ = combate(nave, inim)
            res = r
    lucro = recompensa - fuel * PRECO_FUEL - (nave['HPmax'] - max(hp_final, 0)) * PRECO_REPARO
    return dict(resultado=res, lucro=round(lucro), encontro=encontro, hp_final=max(hp_final, 0))

# ============ RODAR ============
def rodar(n=500):
    nave = dict(NAVE_INICIAL)
    print(f"Nave: {nave}\n")
    for P, label in [(3, 'segura'), (6, 'media'), (8, 'fronteira')]:
        res = {}; lucros = []; enc = 0
        for _ in range(n):
            o = turno(nave, 10, P, PIRATA)
            res[o['resultado']] = res.get(o['resultado'], 0) + 1
            lucros.append(o['lucro'])
            enc += o['encontro']
        print(f"{label:10} P={P}: encontro {enc*100//n}% | lucro medio {sum(lucros)//len(lucros)}")
        print(f"           {res}")
    print("\nCombate direto vs pirata e vs faccao (500 cada):")
    for nome, inim in [('pirata', PIRATA), ('faccao', FACCAO)]:
        r = {}
        for _ in range(500):
            out = combate(dict(NAVE_INICIAL), inim)[0]
            r[out] = r.get(out, 0) + 1
        print(f"  vs {nome}: {r}")

if __name__ == '__main__':
    rodar()
