#!/usr/bin/env python3
"""
SIMULADOR INTEGRADO — Rust and Spark (v0.1)
============================================
Roda milhares de "vidas de jogador" costurando todos os sistemas validados:
  montagem de nave -> escolha de missao -> viagem (combustivel, ambiente, desgaste)
  -> encontro/combate -> economia (recompensa, reparo, falha) -> upgrade -> repetir

Objetivo: achar problemas SISTEMICOS que testes isolados nao pegam
  (economia quebra no turno X? build converge? progressao trava? desgaste espiral?).

USO:
  python3 simulador-integrado.py            # roda o lote padrao e imprime analise
  python3 simulador-integrado.py 5000       # roda 5000 vidas
  Edite os PARAMETROS abaixo e re-rode para varrer o balanceamento.

Todos os numeros sao provisorios (valores iniciais sensatos). O ponto e VARRER.
"""
import random, statistics, sys
from collections import Counter, defaultdict

# ==================== PARAMETROS (varra aqui) ====================
P = dict(
    # --- economia ---
    preco_fuel=1.2, preco_reparo=4.0, custo_engasgo_fuel=2,
    rec_base=250, rec_por_tier=180,     # recompensa = (base+tier*por_tier)*perf*mods
    # --- desgaste ---
    desg_base=(2,4),                    # % por missao, uso normal (min,max)
    desg_ambiente=1.2,                  # multiplicador por nivel de ambiente
    peca_inicial_cond=80,               # pecas gratis vem usadas
    reparo_limiar=45,                   # estrategia do bot: repara abaixo disso
    # --- falha ---
    engasgo_inicio=30,                  # abaixo disso comeca a engasgar
    # --- combate (dials vencedores do torneio) ---
    esquiva=1.5, bli_teto=4, fura=0.35, esc_regen=2, kite=0.2, inic=2,
    # --- progressao ---
    custos_upgrade={2:2500,3:6000,4:12000,5:22000},  # endgame alcancavel (facil p/ testar)
    # --- mundo ---
    n_missoes_max=300,                  # teto por vida
)

# ==================== CATALOGO DE PECAS ====================
PECAS = {
 'ponte':dict(mass=4,HP=30,energia=-1,preco=0),
 'motor_g':dict(mass=14,pot=70,energia=7,fuelUse=2.5,preco=800),
 'motor_p':dict(mass=3,pot=25,energia=2,fuelUse=0.7,preco=100),
 'ion':dict(mass=8,pot=22,energia=-8,preco=600),
 'nuclear':dict(mass=14,energia=18,preco=1400),
 'bateria':dict(mass=5,output=80,preco=150),
 'tanque':dict(mass=5,fuel=1000,preco=200),
 'canhao':dict(mass=3,PDF=3,preco=120),
 'laser':dict(mass=4,PDF=4,energia=-5,preco=350),
 'missil':dict(mass=6,PDF=8,preco=450),
 'placa':dict(mass=10,BLI=4,HP=40,preco=500),
 'casco':dict(mass=4,BLI=1,HP=20,preco=100),
 'escudo':dict(mass=4,ESC=14,energia=-6,preco=400),
 'radar':dict(mass=2,SEN=4,energia=-2,preco=200),
 'carga':dict(mass=2,CRG=5,preco=80),
 'refrig':dict(mass=3,CRG=3,energia=-2,preco=200),
 'pressur':dict(mass=3,CRG=2,energia=-2,preco=220),
 'minerador':dict(mass=8,MIN=1,energia=-3,preco=400),
}

# ==================== AMBIENTES ====================
# nivel: intensidade do desgaste. alvo: subsistema (informativo). fuel_mult: gasto extra.
AMBIENTES = {
 'aberto':      dict(nivel=0.5, fuel_mult=1.0),
 'radiacao':    dict(nivel=2.0, fuel_mult=1.0),
 'detritos':    dict(nivel=2.5, fuel_mult=1.1),
 'gravitacional':dict(nivel=1.5, fuel_mult=1.5),
}

# ==================== MAPA (grafo simples gerado) ====================
def gerar_mapa(n_nos=12):
    nos=[]
    for i in range(n_nos):
        zona=min(3,i//3)  # nos iniciais no centro, ultimos na fronteira
        nos.append(dict(id=i, zona=zona,
                        perigo=zona*2 + random.randint(0,2),
                        remoto=1.0+zona*0.35))
    # rotas: cada no liga a 2-3 vizinhos, distancia ~ diferenca de indice
    rotas={}
    for a in range(n_nos):
        for b in range(a+1, min(a+3, n_nos)):
            dist=300 + abs(a-b)*400 + random.randint(0,300)
            amb=random.choice(list(AMBIENTES) if max(nos[a]['zona'],nos[b]['zona'])>0 else ['aberto'])
            rotas[(a,b)]=dict(dist=dist, perigo=max(nos[a]['perigo'],nos[b]['perigo']), amb=amb)
    return nos, rotas

# ==================== FICHA A PARTIR DE PECAS ====================
def ficha(lista):
    f=dict(pot=0,mass=0,PDF=0,BLI=0,ESC=0,SEN=0,HP=0,energia=0,output=0,fuel=0,CRG=0,MIN=0,preco=0,fuelUse=0)
    for t in lista:
        for k in f: f[k]+=PECAS[t].get(k,0)
    f['MOB']=max(1,round(f['pot']/f['mass']*1.6)) if f['mass'] else 1
    return f

# ==================== BUILDS (arquetipos que o "bot" pode montar) ====================
BUILDS_INICIAIS = {
 'entregador': ['ponte','motor_p','tanque','bateria','carga','carga','casco'],  # usada 80%
}
BUILDS_UPGRADE = {  # o que o bot compra ao subir de tier, por foco
 'carga':   ['ponte','motor_g','tanque','bateria','carga','carga','carga','casco','canhao'],
 'combate': ['ponte','motor_g','tanque','bateria','placa','laser','canhao','radar','casco'],
 'minerador':['ponte','motor_g','tanque','bateria','minerador','carga','carga','casco'],
 'rapido':  ['ponte','motor_g','motor_p','tanque','bateria','canhao','canhao','casco','radar'],
}

def d(n=20): return random.randint(1,n)
def performance(c): return 0.5+0.5*(max(0,c)/100)

# ==================== COMBATE (modelo validado) ====================
def combate(A,B):
    hpA,hpB=A['HP'],B['HP']; escA,escB=A['ESC'],B['ESC']; eAm,eBm=A['ESC'],B['ESC']
    minA,minB=A['HP']*0.2,B['HP']*0.2; dmob=A['MOB']-B['MOB']; primeiro=True
    for _ in range(40):
        if hpA<=minA or hpB<=minB: break
        escA=min(eAm,escA+P['esc_regen']); escB=min(eBm,escB+P['esc_regen'])
        a_kite=max(0,dmob)*P['kite']>random.random(); b_kite=max(0,-dmob)*P['kite']>random.random()
        seq=[('A',A,B),('B',B,A)] if A['SEN']>=B['SEN'] else [('B',B,A),('A',A,B)]
        for nome,atk,dfd in seq:
            hp=hpA if nome=='A' else hpB
            if hp<=(minA if nome=='A' else minB): continue
            if (b_kite if nome=='A' else a_kite): continue
            bonus=P['inic'] if primeiro else 0; primeiro=False
            dc=10+round(dfd['MOB']*P['esquiva'])
            if d(20)+atk['PDF']+bonus>=dc:
                base=atk['PDF']+d(6); fura=base*P['fura'] if atk['PDF']>=8 else 0
                dano=max(1,round((base-fura)-min(dfd['BLI'],P['bli_teto'])+fura))
                if nome=='A': ab=min(escB,dano);escB-=ab;hpB-=dano-ab
                else: ab=min(escA,dano);escA-=ab;hpA-=dano-ab
    if hpB<=minB and hpA>minA: return 'vitoria'
    if hpA<=minA and hpB>minB: return 'derrota'
    return 'empate'

# ==================== UMA VIDA DE JOGADOR ====================
def uma_vida():
    nos,rotas=gerar_mapa()
    build=list(BUILDS_INICIAIS['entregador'])
    cond=P['peca_inicial_cond']            # condicao media das pecas
    f=ficha(build)
    creditos=200; tier=1
    fuel=f['fuel']; fuel_max=f['fuel'] or 1000
    log=dict(missoes=0, combates=0, vitorias=0, derrotas=0, engasgos=0,
             reparos=0, upgrades=[], falencia=False, creditos_hist=[])
    foco=random.choice(list(BUILDS_UPGRADE))  # estilo que esse jogador vai perseguir

    for _ in range(P['n_missoes_max']):
        # -- manutencao --
        if cond<=P['reparo_limiar'] and creditos>0:
            custo=round(f['preco']*((100-cond)/100)*0.8*P['preco_reparo']/4)
            if creditos>=custo:
                creditos-=custo; cond=100; log['reparos']+=1
        # -- escolhe missao (rota aleatoria viavel) --
        rota=random.choice(list(rotas.values()))
        D=rota['dist']; perigo=rota['perigo']; amb=AMBIENTES[rota['amb']]
        perf=performance(cond)
        # combustivel
        fuel_gasto=round(f['fuelUse']*D/100*amb['fuel_mult'])
        if fuel_gasto>fuel_max*1.5:  # rota longe demais pra autonomia
            continue
        # -- engasgo? (peca critica abaixo de 30%) --
        if cond<P['engasgo_inicio']:
            ch=((P['engasgo_inicio']-cond)/P['engasgo_inicio'])**2
            if random.random()<ch:
                log['engasgos']+=1; creditos-=P['custo_engasgo_fuel']*fuel_gasto//10
                cond=max(0,cond-random.uniform(3,8))
                log['creditos_hist'].append(creditos); continue  # missao abortada
        # -- encontro/combate --
        rec=round((P['rec_base']+tier*P['rec_por_tier'])*perf*(1+perigo/15)*(1+(D-800)/3000))
        if random.random() < perigo/20:
            log['combates']+=1
            # NPC ancorado na escala do jogador: pirata ~ mesmo tier, +-, nao stats inflados
            npc_tier=max(1,tier+random.choice([-1,0,0,1]))
            npc_pdf=4+npc_tier*3
            inimigo=dict(MOB=2+perigo//4, PDF=npc_pdf, BLI=1+npc_tier, ESC=0,
                         SEN=perigo//3, HP=(40+npc_tier*35))
            navef=dict(MOB=f['MOB'],PDF=f['PDF'],BLI=f['BLI'],ESC=f['ESC'],SEN=f['SEN'],HP=f['HP']*perf)
            r=combate(navef,inimigo)
            if r=='vitoria': log['vitorias']+=1; creditos+=100+tier*50
            elif r=='derrota': log['derrotas']+=1; creditos-=120; cond=max(0,cond-random.uniform(8,15))
        # -- conclui missao --
        creditos+=rec-round(fuel_gasto*P['preco_fuel'])
        # desgaste da missao
        desg=random.uniform(*P['desg_base'])+amb['nivel']*P['desg_ambiente']
        cond=max(0,cond-desg)
        log['missoes']+=1; log['creditos_hist'].append(creditos)
        # -- upgrade? --
        prox=tier+1
        if prox in P['custos_upgrade'] and creditos>=P['custos_upgrade'][prox]:
            creditos-=P['custos_upgrade'][prox]
            build=list(BUILDS_UPGRADE[foco]); f=ficha(build); fuel_max=f['fuel'] or fuel_max
            cond=90  # nave nova quase novinha
            tier=prox; log['upgrades'].append((log['missoes'],tier))
        # -- falencia? --
        if creditos<-200:
            log['falencia']=True; break
    log['tier_final']=tier; log['foco']=foco; log['creditos_final']=creditos
    return log

# ==================== LOTE + ANALISE ====================
def rodar(n=2000):
    vidas=[uma_vida() for _ in range(n)]
    print(f"=== {n} VIDAS SIMULADAS ===\n")
    # progressao
    tiers=Counter(v['tier_final'] for v in vidas)
    print("Tier final alcancado:")
    for t in sorted(tiers): print(f"  tier {t}: {tiers[t]*100//n:3}% dos jogadores")
    # missoes ate cada upgrade
    print("\nMissoes ate upgrade (mediana):")
    for tg in [2,3,4,5]:
        ms=[m for v in vidas for (m,t) in v['upgrades'] if t==tg]
        if ms: print(f"  tier {tg}: {int(statistics.median(ms))} missoes (n={len(ms)})")
        else: print(f"  tier {tg}: ninguem alcancou")
    # saude economica
    fal=sum(v['falencia'] for v in vidas)
    print(f"\nFalencias: {fal*100//n}%")
    cfin=[v['creditos_final'] for v in vidas]
    print(f"Creditos finais: mediana {int(statistics.median(cfin))}, min {min(cfin)}, max {max(cfin)}")
    # combate
    tot_comb=sum(v['combates'] for v in vidas); tot_vit=sum(v['vitorias'] for v in vidas)
    print(f"\nCombates: {tot_comb} total | vitoria {tot_vit*100//max(1,tot_comb)}%")
    tot_eng=sum(v['engasgos'] for v in vidas); tot_mis=sum(v['missoes'] for v in vidas)
    print(f"Engasgos: {tot_eng} ({tot_eng*100//max(1,tot_mis)}% das missoes) | reparos totais {sum(v['reparos'] for v in vidas)}")
    # foco/build
    print("\nDistribuicao de foco de build (o que jogadores perseguiram):")
    focos=Counter(v['foco'] for v in vidas)
    for fo in focos: print(f"  {fo}: {focos[fo]*100//n}%")
    print("\n-- Alvos saudaveis: falencia <15%, todos os tiers alcancaveis, combate 40-60%,")
    print("   engasgos baixos se reparo_limiar respeitado, nenhum foco dominante --")

if __name__=='__main__':
    n=int(sys.argv[1]) if len(sys.argv)>1 else 2000
    rodar(n)
