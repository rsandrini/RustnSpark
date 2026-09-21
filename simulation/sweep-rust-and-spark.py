#!/usr/bin/env python3
"""
VARREDURA DE BALANCEAMENTO — Rust and Spark (v0.1)
===================================================
Testa MUITAS combinacoes de parametros automaticamente, roda N vidas de jogador em
cada, mede quao "saudavel" cada config e, e ranqueia. Feito pra rodar LOCAL por
minutos/horas — quanto mais tempo, mais combinacoes e mais vidas por combinacao.

USO:
  python3 sweep-rust-and-spark.py                 # varredura padrao
  python3 sweep-rust-and-spark.py --vidas 400 --top 30
  python3 sweep-rust-and-spark.py --full          # grade GIGANTE (deixa rodando)
  python3 sweep-rust-and-spark.py --seed 7

SAIDA:
  - ranking das melhores configs no terminal
  - arquivo sweep-resultados.csv com TODAS as configs e metricas (pra analisar)

Mande o ranking (ou o CSV) de volta e a gente le onde o jogo fica bom.

Nao depende de nada externo (so stdlib). Determinístico por --seed.
"""
import random, statistics, itertools, csv, sys, time

# ==================== ALVOS DE SAUDE (o que "bom" significa) ====================
# Cada metrica tem uma faixa alvo; a config e pontuada pela distancia aos alvos.
ALVOS = dict(
    falencia_pct=(2, 15),        # % de jogadores que faliram: algum risco, nao massacre
    combate_winrate=(45, 60),    # vitoria em combate: justo
    tier5_pct=(15, 55),          # % que chega ao endgame: alcancavel, nao trivial
    missoes_tier2=(4, 10),       # ritmo do 1o upgrade (engaja rapido)
    missoes_tier5=(60, 160),     # endgame de medio/longo prazo
    engasgo_pct=(2, 12),         # % de missoes com engasgo: tensao sem frustracao
    margem_mediana=(80, 400),    # lucro liquido mediano por missao: apertado mas viavel
)

# ==================== CATALOGO (fixo) ====================
PECAS = {
 'ponte':dict(mass=4,HP=30,energia=-1,preco=0),
 'motor_g':dict(mass=14,pot=70,energia=7,fuelUse=2.5,preco=800),
 'motor_p':dict(mass=3,pot=25,energia=2,fuelUse=0.7,preco=100),
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
 'minerador':dict(mass=8,MIN=1,energia=-3,preco=400),
}
AMBIENTES = {
 'aberto':dict(nivel=0.5,fuel_mult=1.0),
 'radiacao':dict(nivel=2.0,fuel_mult=1.0),
 'detritos':dict(nivel=2.5,fuel_mult=1.1),
 'gravitacional':dict(nivel=1.5,fuel_mult=1.5),
}
BUILDS_UPGRADE = {
 'carga':   ['ponte','motor_g','tanque','bateria','carga','carga','carga','casco','canhao'],
 'combate': ['ponte','motor_g','tanque','bateria','placa','laser','canhao','radar','casco'],
 'minerador':['ponte','motor_g','tanque','bateria','minerador','carga','carga','casco'],
 'rapido':  ['ponte','motor_g','motor_p','tanque','bateria','canhao','canhao','casco','radar'],
}
BUILD_INICIAL = ['ponte','motor_p','tanque','bateria','carga','carga','casco']

def ficha(lista):
    f=dict(pot=0,mass=0,PDF=0,BLI=0,ESC=0,SEN=0,HP=0,energia=0,output=0,fuel=0,CRG=0,MIN=0,preco=0,fuelUse=0)
    for t in lista:
        for k in f: f[k]+=PECAS[t].get(k,0)
    f['MOB']=max(1,round(f['pot']/f['mass']*1.6)) if f['mass'] else 1
    return f
def d(n=20): return random.randint(1,n)
def perf(c): return 0.5+0.5*(max(0,c)/100)

# dials de combate fixos (vencedores do torneio)
CB=dict(esquiva=1.5,bli_teto=4,fura=0.35,esc_regen=2,kite=0.2,inic=2)
def combate(A,B):
    hpA,hpB=A['HP'],B['HP']; escA,escB=A['ESC'],B['ESC']; eAm,eBm=A['ESC'],B['ESC']
    minA,minB=A['HP']*0.2,B['HP']*0.2; dmob=A['MOB']-B['MOB']; primeiro=True
    for _ in range(40):
        if hpA<=minA or hpB<=minB: break
        escA=min(eAm,escA+CB['esc_regen']); escB=min(eBm,escB+CB['esc_regen'])
        ak=max(0,dmob)*CB['kite']>random.random(); bk=max(0,-dmob)*CB['kite']>random.random()
        seq=[('A',A,B),('B',B,A)] if A['SEN']>=B['SEN'] else [('B',B,A),('A',A,B)]
        for nome,atk,dfd in seq:
            hp=hpA if nome=='A' else hpB
            if hp<=(minA if nome=='A' else minB): continue
            if (bk if nome=='A' else ak): continue
            bonus=CB['inic'] if primeiro else 0; primeiro=False
            dc=10+round(dfd['MOB']*CB['esquiva'])
            if d(20)+atk['PDF']+bonus>=dc:
                base=atk['PDF']+d(6); fura=base*CB['fura'] if atk['PDF']>=8 else 0
                dano=max(1,round((base-fura)-min(dfd['BLI'],CB['bli_teto'])+fura))
                if nome=='A': ab=min(escB,dano);escB-=ab;hpB-=dano-ab
                else: ab=min(escA,dano);escA-=ab;hpA-=dano-ab
    if hpB<=minB and hpA>minA: return 'vitoria'
    if hpA<=minA and hpB>minB: return 'derrota'
    return 'empate'

def gerar_mapa(n_nos=12):
    nos=[]
    for i in range(n_nos):
        zona=min(3,i//3)
        nos.append(dict(id=i,zona=zona,perigo=zona*2+random.randint(0,2)))
    rotas=[]
    for a in range(n_nos):
        for b in range(a+1,min(a+3,n_nos)):
            dist=300+abs(a-b)*400+random.randint(0,300)
            amb=random.choice(list(AMBIENTES)) if max(nos[a]['zona'],nos[b]['zona'])>0 else 'aberto'
            rotas.append(dict(dist=dist,perigo=max(nos[a]['perigo'],nos[b]['perigo']),amb=amb))
    return rotas

# ==================== UMA VIDA (parametrizada por cfg) ====================
def uma_vida(cfg):
    rotas=gerar_mapa()
    build=list(BUILD_INICIAL); cond=cfg['peca_inicial_cond']; f=ficha(build)
    creditos=200; tier=1; fuel_max=f['fuel'] or 1000
    foco=random.choice(list(BUILDS_UPGRADE))
    m=dict(missoes=0,combates=0,vitorias=0,engasgos=0,reparos=0,falencia=False,
           up={}, margens=[])
    for _ in range(cfg['n_missoes_max']):
        if cond<=cfg['reparo_limiar'] and creditos>0:
            custo=round(f['preco']*((100-cond)/100)*0.8*(cfg['preco_reparo']/4)) + tier*cfg['manutencao_tier']
            if creditos>=custo: creditos-=custo; cond=100; m['reparos']+=1
        rota=random.choice(rotas); D=rota['dist']; perigo=rota['perigo']; amb=AMBIENTES[rota['amb']]
        pf=perf(cond)
        fuel_gasto=round(f['fuelUse']*D/100*amb['fuel_mult'])
        if fuel_gasto>fuel_max*1.5: continue
        # engasgo
        if cond<cfg['engasgo_inicio']:
            ch=((cfg['engasgo_inicio']-cond)/cfg['engasgo_inicio'])**2
            if random.random()<ch:
                m['engasgos']+=1; creditos-=fuel_gasto*cfg['preco_fuel']//5
                cond=max(0,cond-random.uniform(3,8)); continue
        antes=creditos
        rec=round((cfg['rec_base']+tier*cfg['rec_por_tier'])*pf*(1+perigo/15)*(1+(D-800)/3000))
        if random.random()<perigo/20:
            m['combates']+=1
            # NPC ancorado na FICHA REAL do jogador (nao stats inventados):
            # escala com o PDF/HP do jogador +- variacao, pra combate ser disputado
            var=random.choice([0.55,0.7,0.8,0.85,1.0,1.1])  # ajustado: NPC um pouco mais fraco p/ winrate ~50%  # forca relativa do inimigo
            ini=dict(MOB=max(1,f['MOB']+random.choice([-1,0,1])),
                     PDF=max(2,round(f['PDF']*var)),
                     BLI=max(0,round(f['BLI']*var*0.6)),
                     ESC=0, SEN=max(0,f['SEN']+random.choice([-1,0,1])),
                     HP=max(30,round(f['HP']*var)))
            nav=dict(MOB=f['MOB'],PDF=f['PDF'],BLI=f['BLI'],ESC=f['ESC'],SEN=f['SEN'],HP=f['HP']*pf)
            r=combate(nav,ini)
            if r=='vitoria': m['vitorias']+=1; creditos+=100+tier*50
            elif r=='derrota': creditos-=120; cond=max(0,cond-random.uniform(8,15))
        creditos+=rec-round(fuel_gasto*cfg['preco_fuel'])
        desg=random.uniform(*cfg['desg_base'])+amb['nivel']*cfg['desg_ambiente']
        cond=max(0,cond-desg)
        m['missoes']+=1; m['margens'].append(creditos-antes)
        prox=tier+1
        if prox in cfg['custos_upgrade'] and creditos>=cfg['custos_upgrade'][prox]:
            creditos-=cfg['custos_upgrade'][prox]; build=list(BUILDS_UPGRADE[foco])
            f=ficha(build); fuel_max=f['fuel'] or fuel_max; cond=90; tier=prox
            m['up'][tier]=m['missoes']
        if creditos<-200: m['falencia']=True; break
    m['tier_final']=tier
    return m

def avaliar_cfg(cfg, vidas):
    L=[uma_vida(cfg) for _ in range(vidas)]
    n=len(L)
    falencia=sum(x['falencia'] for x in L)/n*100
    tc=sum(x['combates'] for x in L); tv=sum(x['vitorias'] for x in L)
    winrate=tv/max(1,tc)*100
    tier5=sum(1 for x in L if x['tier_final']>=5)/n*100
    m2=[x['up'][2] for x in L if 2 in x['up']]; m5=[x['up'][5] for x in L if 5 in x['up']]
    tm=sum(x['missoes'] for x in L); te=sum(x['engasgos'] for x in L)
    engasgo=te/max(1,tm+te)*100   # % sobre TENTATIVAS (missoes+engasgos), nao so concluidas
    todas_margens=[g for x in L for g in x['margens']]
    margem=statistics.median(todas_margens) if todas_margens else 0
    met=dict(
        falencia_pct=falencia, combate_winrate=winrate, tier5_pct=tier5,
        missoes_tier2=statistics.median(m2) if m2 else 999,
        missoes_tier5=statistics.median(m5) if m5 else 999,
        engasgo_pct=engasgo, margem_mediana=margem,
    )
    # score: soma das distancias normalizadas fora da faixa alvo (menor = melhor)
    score=0
    for k,(lo,hi) in ALVOS.items():
        v=met[k]
        if v<lo: score+=(lo-v)/max(1,hi-lo)
        elif v>hi: score+=(v-hi)/max(1,hi-lo)
    met['score']=round(score,3)
    return met

# ==================== GRADE DE VARREDURA ====================
def grade(full=False, grosso=False, focado=False):
    if grosso:
        # VARREDURA GROSSA: poucos valores por parametro, acha a REGIAO boa rapido.
        # ~3^4 * 2^4 = poucas centenas de configs. Rode isto primeiro.
        g=dict(
            preco_fuel=[2.0,4.0],
            preco_reparo=[8,16],
            rec_base=[100,180,260],
            rec_por_tier=[50,100],
            desg_base=[(3,5),(6,10)],
            desg_ambiente=[1.5,2.5],
            manutencao_tier=[150,400],
            reparo_limiar=[40,55],
        )
    elif full:
        g=dict(
            preco_fuel=[2.0,3.0,4.0,6.0],
            preco_reparo=[6,12,20],
            rec_base=[80,140,200],
            rec_por_tier=[40,80,120],
            desg_base=[(3,5),(5,8),(8,12)],
            desg_ambiente=[1.2,2.0,3.0],
            manutencao_tier=[100,300,600],
            reparo_limiar=[35,45,55],
        )
    elif focado:
        # numeros convergidos TRAVADOS; varre so custos de upgrade e ajuste fino
        g=dict(
            preco_fuel=[3.0],
            preco_reparo=[6],
            rec_base=[200],
            rec_por_tier=[120],
            desg_base=[(3,5)],
            desg_ambiente=[1.2],
            manutencao_tier=[100,200,350],
            reparo_limiar=[45],
        )
    else:
        g=dict(
            preco_fuel=[3.0,5.0],
            preco_reparo=[8,16],
            rec_base=[100,180],
            rec_por_tier=[50,90],
            desg_base=[(4,7),(7,11)],
            desg_ambiente=[1.5,2.5],
            manutencao_tier=[150,400],
            reparo_limiar=[45],
        )
    fixos=dict(
        peca_inicial_cond=80, engasgo_inicio=30,
        custos_upgrade={2:2500,3:7000,4:16000,5:32000}, n_missoes_max=300,
    )
    keys=list(g)
    combos=list(itertools.product(*[g[k] for k in keys]))
    for c in combos:
        cfg=dict(fixos); cfg.update({keys[i]:c[i] for i in range(len(keys))})
        yield cfg

def _arg(args, nome, default, tipo=int):
    # le --nome VALOR de forma segura: se faltar o valor ou for invalido, usa default
    if nome in args:
        i=args.index(nome)
        if i+1 < len(args):
            try: return tipo(args[i+1])
            except (ValueError, TypeError): return default
    return default

def main():
    args=sys.argv[1:]
    full='--full' in args
    vidas=_arg(args,'--vidas',300)
    top=_arg(args,'--top',25)
    seed=_arg(args,'--seed',None)
    if seed is not None: random.seed(seed)
    configs=list(grade(full, focado='--focado' in args))
    total=len(configs)
    print(f"Varredura: {total} configs x {vidas} vidas = {total*vidas} vidas simuladas")
    print("(rode com --full e --vidas alto pra deixar processando por mais tempo)\n")
    t0=time.time(); resultados=[]
    for i,cfg in enumerate(configs):
        met=avaliar_cfg(cfg,vidas)
        resultados.append((met['score'],cfg,met))
        if (i+1)%max(1,total//20)==0:
            el=time.time()-t0
            print(f"  {i+1}/{total} configs ({el:.0f}s, ~{el/(i+1)*(total-i-1):.0f}s restantes)")
    resultados.sort(key=lambda x:x[0])
    # CSV completo
    campos=['score']+list(ALVOS)+['preco_fuel','preco_reparo','rec_base','rec_por_tier',
            'desg_base','desg_ambiente','manutencao_tier','reparo_limiar']
    with open('sweep-resultados.csv','w',newline='') as fp:
        w=csv.writer(fp); w.writerow(campos)
        for score,cfg,met in resultados:
            w.writerow([met['score']]+[round(met[k],1) for k in ALVOS]+
                       [cfg['preco_fuel'],cfg['preco_reparo'],cfg['rec_base'],cfg['rec_por_tier'],
                        cfg['desg_base'],cfg['desg_ambiente'],cfg['manutencao_tier'],cfg['reparo_limiar']])
    print(f"\nCSV salvo: sweep-resultados.csv ({total} linhas)\n")
    print(f"=== TOP {top} CONFIGS (menor score = mais perto dos alvos) ===\n")
    for score,cfg,met in resultados[:top]:
        print(f"score {met['score']:.2f} | fuel {cfg['preco_fuel']} reparo {cfg['preco_reparo']} "
              f"recB {cfg['rec_base']} recT {cfg['rec_por_tier']} desg {cfg['desg_base']} "
              f"amb {cfg['desg_ambiente']} manut {cfg['manutencao_tier']}")
        print(f"      falencia {met['falencia_pct']:.0f}% | winrate {met['combate_winrate']:.0f}% | "
              f"tier5 {met['tier5_pct']:.0f}% | t2 {met['missoes_tier2']:.0f}mis | "
              f"t5 {met['missoes_tier5']:.0f}mis | engasgo {met['engasgo_pct']:.0f}% | margem {met['margem_mediana']:.0f}")
    print("\nAlvos:", {k:f"{lo}-{hi}" for k,(lo,hi) in ALVOS.items()})
    print("\nMande o TOP acima (ou o CSV) de volta e a gente analisa onde fica bom.")

if __name__=='__main__':
    main()
