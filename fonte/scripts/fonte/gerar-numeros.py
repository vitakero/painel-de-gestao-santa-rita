# FABRICA A FONTE DOS NUMEROS 1 E 7 DO CARTAZ.
#
# POR QUE ISTO EXISTE
#   Na Bangers (a letra do cartaz) o "1" e o "7" sao quase o mesmo traco inclinado. Na
#   gondola, a 3 metros, "17,99" pode ser lido como "11,99" ou "77,99" — o pior erro que um
#   cartaz de preco pode ter. O dono pediu em 17/09/2026: trocar a letra SO do 1 e do 7,
#   deixando o resto da placa exatamente como esta.
#
# POR QUE NAO BASTA APONTAR PRA OUTRA FONTE
#   Medi no PDF impresso: so apontar o CSS pra outra fonte deixa o preco 13% mais ALTO e o
#   "17,99" 45% mais LARGO que hoje. Duas causas:
#     (1) cada fonte traz a propria altura de linha (ascent/descent);
#     (2) o 1 e o 7 das outras fontes sao mais gordos que os da Bangers.
#   O estrago: "17,99" sairia de um tamanho e "22,99" de outro, na mesma parede.
#
# O QUE ESTE SCRIPT FAZ
#   Tira da fonte doadora SO o 1 e o 7 e molda os dois pra caberem no lugar exato dos da
#   Bangers: mesma altura de linha, mesma altura de numero e MESMA LARGURA DE AVANCO. Com
#   isso o cartaz nao precisa de recalibracao nenhuma — o preco ocupa o mesmo espaco de
#   sempre, so muda o desenho.
#
#   Sai um .woff minusculo (2 desenhos so) em base64, pra colar embutido no painel. Embutido
#   de proposito: nao depende do Google na hora de imprimir e funciona com a internet caida.
#
# USO:  python3 scripts/fonte/gerar-numeros.py Anton-Regular.ttf saida.txt
import sys, base64, io, statistics, math
from fontTools.ttLib import TTFont
from fontTools import subset
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.pens.recordingPen import RecordingPen
from fontTools.misc.transform import Transform

# A INCLINACAO DA BANGERS, MEDIDA — nao chutada.
# Os numeros da Bangers sao inclinados ~11 graus. Um numero EM PE no meio deles destoa, e
# tem um efeito pratico que eu so vi ampliando a folha: o "1" em pe encosta no "R$", porque
# quem afastava os dois era justamente a inclinacao.
# Como medir sem chutar: procuro a inclinacao que, ao ser DESFEITA, deixa o desenho mais
# estreito — um traco inclinado so fica "reto" no angulo certo. Os digitos retos da Bangers
# (0,1,2,3,4,5,8) concordam em 0.18-0.27; o 6 e o 9 sao redondos e nao opinam.
def inclinacao_de(arq, digitos="012345678"):
    f = TTFont(arq); gs = f.getGlyphSet(); cmap = f.getBestCmap(); achados = []
    for ch in digitos:
        g = cmap.get(ord(ch))
        if not g: continue
        pen = RecordingPen(); gs[g].draw(pen); pts = []
        for _, args in pen.value:
            for a in args:
                if isinstance(a, tuple) and len(a) == 2 and all(isinstance(v, (int, float)) for v in a):
                    pts.append(a)
                elif isinstance(a, (list, tuple)):
                    pts += [q for q in a if isinstance(q, tuple) and len(q) == 2]
        if len(pts) < 8: continue
        ys = [y for _, y in pts]; meio = (min(ys) + max(ys)) / 2
        melhor = (0.0, 1e18); s = -0.10
        while s <= 0.45:
            xs = [x - s * (y - meio) for x, y in pts]
            larg = max(xs) - min(xs)
            if larg < melhor[1]: melhor = (s, larg)
            s += 0.005
        achados.append(melhor[0])
    return statistics.median(achados) if achados else 0.0

BANGERS = sys.argv[3] if len(sys.argv) > 3 else "Bangers.ttf"
DOADORA = sys.argv[1]
SAIDA   = sys.argv[2]

# ---------------------------------------------------------------- o molde: a Bangers
b = TTFont(BANGERS)
bupm = b['head'].unitsPerEm
bcmap = b.getBestCmap(); bglyf = b['glyf']; bhmtx = b['hmtx']
def bang(ch):
    g = bcmap[ord(ch)]
    return dict(topo=bglyf[g].yMax / bupm, larg=bhmtx[g][0] / bupm)

# ALTURA ALVO = a media do topo dos digitos que CONTINUAM Bangers (0,2,3,4,5,6,8,9).
# E com esses que o 1 e o 7 vao dividir o preco, entao e com esses que tem que emparelhar —
# nao com o 1 e o 7 velhos, que eram justamente os errados.
FICAM = "02345689"
ALVO_TOPO = sum(bang(c)['topo'] for c in FICAM) / len(FICAM)
ALVO_LARG = {"1": bang("1")['larg'], "7": bang("7")['larg']}
ASC  = b['hhea'].ascent  / bupm
DESC = b['hhea'].descent / bupm

INCLINA = inclinacao_de(BANGERS)
# a folga da esquerda de cada numero, pra ancorar o novo no mesmo lugar do velho
ALVO_LSB = {ch: bglyf[bcmap[ord(ch)]].xMin / bupm for ch in "17"}

print(f"molde (Bangers): topo dos numeros {ALVO_TOPO*100:.2f}%  "
      f"largura 1={ALVO_LARG['1']*100:.1f}% 7={ALVO_LARG['7']*100:.1f}%  "
      f"linha asc={ASC*100:.1f}% desc={DESC*100:.1f}%")
print(f"                 inclinacao {INCLINA:+.3f} ({math.degrees(math.atan(INCLINA)):.1f} graus)  "
      f"folga esquerda 1={ALVO_LSB['1']*100:.1f}% 7={ALVO_LSB['7']*100:.1f}%")

# ---------------------------------------------------------------- so o 1 e o 7 da doadora
f = TTFont(DOADORA)
op = subset.Options(); op.glyph_names = True; op.notdef_outline = True
op.layout_features = []; op.drop_tables += ['DSIG']
s = subset.Subsetter(options=op); s.populate(unicodes=[0x31, 0x37]); s.subset(f)

upm = f['head'].unitsPerEm
cmap = f.getBestCmap(); glyf = f['glyf']; hmtx = f['hmtx']; gs = f.getGlyphSet()
nomes = {ch: cmap[ord(ch)] for ch in "17"}

# UMA ESCALA SO, IGUAL NOS DOIS EIXOS E IGUAL NOS DOIS NUMEROS.
#
# A PRIMEIRA VERSAO ERROU AQUI, e o dono pegou na hora: eu forcava cada numero a ter a
# largura EXATA do da Bangers, achando que assim o cartaz nao mudava nada. So que isso
# exigia espremer o 7 em 0,69 e o 1 em 0,97 — e espremer AFINA o traco. Medido na folha de
# 240 dpi: o traco do 1 saiu com 105px e o do 7 com 78px, 26% de diferenca entre irmaos.
# ("o 7 ficou muito fino, queria deixar na mesma espessura do 1" — 17/09/2026)
#
# Escala uniforme nao deforma nada: a doadora ja desenha o 1 e o 7 com o mesmo traco, e
# essa relacao se mantem. Medido depois da correcao: 1=93px, 7=97px, contra 94 e 100 da
# Bangers — casa com os irmaos E com os vizinhos.
#
# O PRECO DISSO: as larguras deixam de bater na unha com as da Bangers (o 7 da Anton e mais
# largo). Medi o estrago: "17,99" fica ~7% mais largo. Cabe folgado — o cartaz ja aguenta
# "88,88", que e bem mais largo que qualquer preco com 7.
topos = [glyf[nomes[ch]].yMax / upm for ch in "17"]
k = ALVO_TOPO / (sum(topos) / len(topos))
kv = k
kh = {ch: k for ch in "17"}

avanco_original = {ch: hmtx[nomes[ch]][0] for ch in "17"}
for ch in "17":
    g = nomes[ch]
    # A ORDEM IMPORTA: primeiro estica/espreme, depois INCLINA em torno da metade da altura
    # (é assim que a Bangers desenha: o numero fica centrado na caixa dele, com o topo pra
    # direita e a base pra esquerda). Inclinar em torno da base jogaria o numero todo pro lado.
    meio = (glyf[g].yMax * kv) / 2
    m = Transform(1, 0, INCLINA, 1, -INCLINA * meio, 0).transform(Transform(kh[ch], 0, 0, kv, 0, 0))
    pen = TTGlyphPen(gs)
    gs[g].draw(TransformPen(pen, m))
    glyf[g] = pen.glyph()
    glyf[g].recalcBounds(glyf)
    # O AVANCO acompanha a escala, em vez de ser forcado no da Bangers. Foi a troca que
    # devolveu a espessura do traco (ver o comentario da escala, acima).
    hmtx[g] = (round(avanco_original[ch] * k), glyf[g].xMin)
    print(f"  {ch}: escala x{k:.3f} nos dois eixos  inclinado {INCLINA:+.3f}  ->  "
          f"topo {glyf[g].yMax/upm*100:.2f}%  avanco {hmtx[g][0]/upm*100:.1f}% "
          f"(Bangers tem {ALVO_LARG[ch]*100:.1f}%)")

# LINHA: as metricas verticais viram AS DA BANGERS. Sem isto o preco cresce em altura mesmo
# com o desenho do tamanho certo — a caixa da linha e que muda.
for tab, campos in [('hhea', [('ascent', ASC), ('descent', DESC), ('lineGap', 0.0)]),
                    ('OS/2', [('sTypoAscender', ASC), ('sTypoDescender', DESC), ('sTypoLineGap', 0.0),
                              ('usWinAscent', ASC), ('usWinDescent', -DESC)])]:
    for campo, v in campos:
        setattr(f[tab], campo, round(v * upm))
f['OS/2'].fsSelection |= (1 << 7)          # USE_TYPO_METRICS: manda usar as metricas acima

buf = io.BytesIO(); f.flavor = "woff"; f.save(buf)       # woff (zlib) — nao precisa de brotli
b64 = base64.b64encode(buf.getvalue()).decode()
open(SAIDA, "w").write(b64)
print(f"\n-> {SAIDA}: {len(buf.getvalue())} bytes de fonte, {len(b64)} de base64")
