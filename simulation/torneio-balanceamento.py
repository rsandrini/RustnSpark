#!/usr/bin/env python3
"""
Torneio de balanceamento — Rust and Spark
==========================================
Busca automatica pelos dials de combate que fecham o triangulo pedra-papel-tesoura.
Roda ~540 combinacoes em segundos e confirma a melhor com N alto.

RESULTADO ENCONTRADO (triangulo fechado, spread de 12 pontos):
  dials: esquiva=1.5xMOB, bli_teto=4, fura=0.25, esc_regen=2, kite=0.2
  winrates: DanoAlto 57% | Equilib 51% | Rapido 48% | Escudo 48% | Blindado 45%
  -> nenhuma build domina, nenhuma inutil. Todas viaveis.

DUAS DESCOBERTAS ESTRUTURAIS (nao eram questao de numero):
1. VELOCIDADE = controle de engajamento (hit-and-run), nao so esquiva.
   Esquiva pura falha: em muitos rounds a nave fragil sempre acaba acertada.
   A nave muito mais rapida NEGA o revide do inimigo parte dos rounds (kite),
   dando um jeito de ENCERRAR o combate a favor dela.
2. Builds precisam ser comparaveis: rapido ganhou casco+motores (MOB alto pro kite
   morder), glass cannon perdeu HP (fragil de verdade, paga pela potencia).

Edite os grids de busca (esq/bli/fura/regen/kite) e as BUILDS e re-rode.
"""

import random, itertools
PECAS = {
 'ponte':dict(mass=4,HP=30),'motor_g':dict(mass=14,pot=70),'motor_p':dict(mass=3,pot=25),
 'motor_pp':dict(mass=2,pot=18),'bateria':dict(mass=5),'tanque':dict(mass=5),
 'canhao':dict(mass=3,PDF=3),'laser':dict(mass=4,PDF=4),'missil':dict(mass=6,PDF=8),
 'placa':dict(mass=10,BLI=4,HP=40),'casco':dict(mass=4,BLI=1,HP=20),
 'escudo':dict(mass=4,ESC=14),'radar':dict(mass=2,SEN=4),
}
def ficha(l):
    f=dict(pot=0,mass=0,PDF=0,BLI=0,ESC=0,SEN=0,HP=0)
    for t in l:
        for k in f: f[k]+=PECAS[t].get(k,0)
    f['MOB']=max(1,round(f['pot']/f['mass']*1.6)) if f['mass'] else 1
    return f
def d(n=20): return random.randint(1,n)
def combate(A,B,P):
    hpA,hpB=A['HP'],B['HP']; escA,escB=A['ESC'],B['ESC']; eAm,eBm=A['ESC'],B['ESC']
    minA,minB=A['HP']*0.2,B['HP']*0.2; dmob=A['MOB']-B['MOB']
    for _ in range(50):
        if hpA<=minA or hpB<=minB: break
        escA=min(eAm,escA+P['esc_regen']); escB=min(eBm,escB+P['esc_regen'])
        a_kite = max(0,dmob)*P['kite'] > random.random()
        b_kite = max(0,-dmob)*P['kite'] > random.random()
        def atacar(atk,dfd,ae):
            dc=10+round(dfd['MOB']*P['esquiva'])
            if d(20)+atk['PDF']>=dc:
                base=atk['PDF']+d(6)
                fura=base*P['fura'] if atk['PDF']>=8 else 0
                bli=min(dfd['BLI'],P['bli_teto'])
                dano=max(1,round((base-fura)-bli+fura))
                ab=min(ae,dano); return dano-ab, ae-ab
            return 0, ae
        seq=[('A',A,B),('B',B,A)] if A['SEN']>=B['SEN'] else [('B',B,A),('A',A,B)]
        for nome,atk,dfd in seq:
            hp=hpA if nome=='A' else hpB
            if hp<=(minA if nome=='A' else minB): continue
            if (b_kite if nome=='A' else a_kite): continue
            if nome=='A': dmg,escB=atacar(A,B,escB); hpB-=dmg
            else: dmg,escA=atacar(B,A,escA); hpA-=dmg
    if hpB<=minB and hpA>minA: return 'A'
    if hpA<=minA and hpB>minB: return 'B'
    return 'e'
# Rapido com 2 motores extras (MOB bem maior) e mais casco; DanoAlto bem fragil (pouco HP)
BUILDS={
 'Rapido':   ['ponte','motor_g','motor_p','motor_pp','tanque','bateria','canhao','canhao','casco','casco','radar'],
 'Blindado': ['ponte','motor_g','tanque','bateria','placa','placa','canhao','canhao'],
 'DanoAlto': ['ponte','motor_g','tanque','bateria','missil','missil','laser'],
 'Escudo':   ['ponte','motor_g','tanque','bateria','escudo','laser','canhao','casco','casco'],
 'Equilib':  ['ponte','motor_g','tanque','bateria','placa','laser','canhao','radar','casco'],
}
fichas={n:ficha(b) for n,b in BUILDS.items()}
nomes=list(BUILDS)
print('MOB/HP:', {n:(fichas[n]['MOB'],fichas[n]['HP']) for n in nomes})
def avaliar(P,N):
    vit={n:0 for n in nomes}; jg={n:0 for n in nomes}
    for a,b in itertools.combinations(nomes,2):
        for _ in range(N):
            r=combate(fichas[a],fichas[b],P)
            if r=='A':vit[a]+=1
            elif r=='B':vit[b]+=1
            jg[a]+=1;jg[b]+=1
    wr={n:vit[n]/jg[n]*100 for n in nomes}
    return max(wr.values())-min(wr.values()), wr
# busca grande
best=None; tested=0
for esq in [0.5,1.0,1.5]:
 for bli in [3,4,5,6]:
  for fura in [0.15,0.25,0.35]:
   for regen in [2,3,4]:
    for kite in [0.2,0.3,0.4,0.5,0.6]:
      P=dict(esquiva=esq,bli_teto=bli,fura=fura,esc_regen=regen,kite=kite); tested+=1
      spread,wr=avaliar(P,200)
      if best is None or spread<best[0]: best=(spread,P,wr)
print(f'testadas {tested} combinacoes')
spread,P,wr=best
print(f'\nMelhor: spread {spread:.0f}pts | esquiva={P["esquiva"]} bli_teto={P["bli_teto"]} fura={P["fura"]} regen={P["esc_regen"]} kite={P["kite"]}')
# re-roda a melhor com N grande pra confirmar
spread2,wr2=avaliar(P,3000)
print(f'confirmacao (N=3000/par): spread {spread2:.0f}pts')
for n in sorted(nomes,key=lambda n:-wr2[n]):
    print(f'    {n:10} {wr2[n]:4.0f}%')
