#!/usr/bin/env python3
# ════════════════════════════════════════════════════════════════════════════
#   Gera os ícones dos dois apps com PIL (Pillow).
#     python scripts/make-icons.py              → AgendaPro e WorkPro
#     python scripts/make-icons.py agendapro    → só AgendaPro
#     python scripts/make-icons.py workpro      → só WorkPro
#     python scripts/make-icons.py workpro --out C:/tmp/icones   → grava em outra pasta (conferir)
#
#   AgendaPro (assets/ e store/)            WorkPro (assets/workpro/ e store/workpro/)
#   icon.png            1024x1024, sem transparência (App Store / ícone iOS)
#   adaptive-icon.png   1024x1024, só o símbolo, fundo transparente
#                       (app.config usa backgroundColor #1F4D3F / #1B2845 no Android)
#   splash-icon.png     1024x1024 transparente, símbolo num quadrado arredondado
#                       da cor do app (a splash é creme #FAF7F0)
#   favicon.png         48x48 (preview web)
#   play-icon-512.png   512x512 (ícone de alta resolução do Google Play)
#   play-feature-graphic.png 1024x500 (gráfico de destaque do Google Play)
#
#   Desenha em 4x e reduz com LANCZOS (antialias).
#   AgendaPro: calendário creme com cabeçalho dourado e um check verde-bandeira.
#   WorkPro:   prancheta creme com presilha dourada e um check azul-marinho.
# ════════════════════════════════════════════════════════════════════════════
import sys
from pathlib import Path
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / 'assets'
STORE = ROOT / 'store'
SS = 4  # supersampling

GREEN = (31, 77, 63)        # #1F4D3F
GREEN_DEEP = (20, 53, 39)   # #143527
CREAM = (250, 247, 240)     # #FAF7F0
GOLD = (184, 148, 59)       # #B8943B
FLAG = (0, 156, 59)         # #009C3B
SHADOW = (8, 28, 21)

NAVY = (27, 40, 69)         # #1B2845 (cor principal do WorkPro)
NAVY_TOP = (36, 53, 90)     # topo do gradiente, um pouco mais claro
NAVY_DEEP = (17, 26, 46)    # #111A2E
NAVY_SHADOW = (5, 9, 19)

# Geometria do símbolo em "unidades" (o símbolo inteiro tem ~600 x 634),
# relativa ao centro da caixa do símbolo.
BODY = (-300, -263, 300, 317)     # corpo do calendário
BODY_R = 92
HEADER_BOTTOM = -103              # fim da faixa dourada
RINGS_X = (-150, 150)             # argolas
RING_W = 64
RING_TOP, RING_BOTTOM = -317, -203
RING_GAP = 16                     # recorte em volta das argolas
CHECK = [(-162, 102), (-47, 212), (163, -8)]
CHECK_W = 82

# WorkPro: prancheta (~524 x 676), mesma escala do calendário
WP_BOARD = (-262, -222, 262, 338)     # tábua creme
WP_BOARD_R = 72
WP_CLIP_BASE = (-152, -254, 152, -158)  # presilha dourada (parte larga, morde a tábua)
WP_CLIP_BASE_R = 38
WP_CLIP_TOP = (-84, -338, 84, -196)   # aba de cima da presilha
WP_CLIP_TOP_R = 58
WP_HOLE = (0, -280, 26)               # furo da aba (cx, cy, r): transparente
WP_CLIP_GAP = 14                      # recorte em volta da presilha sobre a tábua
WP_CHECK = [(-142, 84), (-40, 186), (150, -6)]
WP_CHECK_W = 86


def gradient(size, top, bottom):
    """Gradiente vertical simples."""
    mask = Image.linear_gradient('L').resize((size[0], size[1]), Image.BILINEAR)
    a = Image.new('RGB', size, top)
    b = Image.new('RGB', size, bottom)
    return Image.composite(b, a, mask)


def symbol(size, scale, center):
    """Camada RGBA (já em 4x) com o calendário. `scale` = px finais por unidade."""
    W, H = size[0] * SS, size[1] * SS
    cx, cy = center[0] * SS, center[1] * SS
    k = scale * SS

    def P(x, y):
        return (cx + x * k, cy + y * k)

    def box(b, grow=0):
        return (cx + (b[0] - grow) * k, cy + (b[1] - grow) * k, cx + (b[2] + grow) * k, cy + (b[3] + grow) * k)

    # Cor do corpo: dourado em cima, creme embaixo
    color = Image.new('RGBA', (W, H), CREAM + (255,))
    ImageDraw.Draw(color).rectangle((0, 0, W, cy + HEADER_BOTTOM * k), fill=GOLD + (255,))

    body = Image.new('L', (W, H), 0)
    ImageDraw.Draw(body).rounded_rectangle(box(BODY), radius=BODY_R * k, fill=255)

    # Recorte transparente em volta das argolas (parece furo no cabeçalho)
    cut = Image.new('L', (W, H), 0)
    dc = ImageDraw.Draw(cut)
    for x in RINGS_X:
        r = (x - RING_W / 2, RING_TOP, x + RING_W / 2, RING_BOTTOM)
        dc.rounded_rectangle(box(r, RING_GAP), radius=(RING_W / 2 + RING_GAP) * k, fill=255)

    layer = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    layer.paste(color, (0, 0), ImageChops.subtract(body, cut))

    d = ImageDraw.Draw(layer)
    # Argolas
    for x in RINGS_X:
        r = (x - RING_W / 2, RING_TOP, x + RING_W / 2, RING_BOTTOM)
        d.rounded_rectangle(box(r), radius=RING_W / 2 * k, fill=CREAM + (255,))
    # Check com pontas e junta arredondadas
    pts = [P(*p) for p in CHECK]
    d.line(pts, fill=FLAG + (255,), width=round(CHECK_W * k), joint='curve')
    rr = CHECK_W * k / 2
    for (x, y) in (pts[0], pts[-1]):
        d.ellipse((x - rr, y - rr, x + rr, y + rr), fill=FLAG + (255,))
    return layer, body


def symbol_workpro(size, scale, center):
    """Camada RGBA (já em 4x) com a prancheta do WorkPro. Devolve (camada, máscara pra sombra)."""
    W, H = size[0] * SS, size[1] * SS
    cx, cy = center[0] * SS, center[1] * SS
    k = scale * SS

    def P(x, y):
        return (cx + x * k, cy + y * k)

    def box(b, grow=0):
        return (cx + (b[0] - grow) * k, cy + (b[1] - grow) * k, cx + (b[2] + grow) * k, cy + (b[3] + grow) * k)

    # Presilha: parte larga + aba de cima, menos o furo
    clip = Image.new('L', (W, H), 0)
    dc = ImageDraw.Draw(clip)
    dc.rounded_rectangle(box(WP_CLIP_BASE), radius=WP_CLIP_BASE_R * k, fill=255)
    dc.rounded_rectangle(box(WP_CLIP_TOP), radius=WP_CLIP_TOP_R * k, fill=255)
    hx, hy, hr = WP_HOLE
    dc.ellipse((cx + (hx - hr) * k, cy + (hy - hr) * k, cx + (hx + hr) * k, cy + (hy + hr) * k), fill=0)

    # Recorte fino em volta da presilha, pra ela "descolar" da tábua
    gap = Image.new('L', (W, H), 0)
    dg = ImageDraw.Draw(gap)
    dg.rounded_rectangle(box(WP_CLIP_BASE, WP_CLIP_GAP), radius=(WP_CLIP_BASE_R + WP_CLIP_GAP) * k, fill=255)
    dg.rounded_rectangle(box(WP_CLIP_TOP, WP_CLIP_GAP), radius=(WP_CLIP_TOP_R + WP_CLIP_GAP) * k, fill=255)

    board = Image.new('L', (W, H), 0)
    ImageDraw.Draw(board).rounded_rectangle(box(WP_BOARD), radius=WP_BOARD_R * k, fill=255)

    layer = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    layer.paste(Image.new('RGBA', (W, H), CREAM + (255,)), (0, 0), ImageChops.subtract(board, gap))
    layer.paste(Image.new('RGBA', (W, H), GOLD + (255,)), (0, 0), clip)

    d = ImageDraw.Draw(layer)
    # Check azul-marinho com pontas e junta arredondadas
    pts = [P(*p) for p in WP_CHECK]
    d.line(pts, fill=NAVY + (255,), width=round(WP_CHECK_W * k), joint='curve')
    rr = WP_CHECK_W * k / 2
    for (x, y) in (pts[0], pts[-1]):
        d.ellipse((x - rr, y - rr, x + rr, y + rr), fill=NAVY + (255,))
    return layer, ImageChops.lighter(board, clip)


def shadow_from(mask, offset_px, blur_px, opacity, color=SHADOW):
    """Sombra suave (4x) a partir de uma máscara."""
    sh = Image.new('L', mask.size, 0)
    sh.paste(mask, (0, round(offset_px * SS)))
    sh = sh.filter(ImageFilter.GaussianBlur(blur_px * SS))
    sh = sh.point(lambda v: int(v * opacity))
    out = Image.new('RGBA', mask.size, color + (0,))
    out.putalpha(sh)
    return out


def down(img, size):
    return img.resize(size, Image.LANCZOS)


# Estilo de cada app: símbolo, gradiente do fundo, sombra, pastas e textos da arte do Google Play
STYLES = {
    'agendapro': {
        'symbol': symbol,
        'icon_k': 1.0,           # tamanho do símbolo no ícone cheio
        'grad': ((35, 86, 70), GREEN_DEEP),
        'shadow': SHADOW,
        'assets': ASSETS,
        'store': STORE,
        'title': 'AgendaPro',
        'lines': ['Agenda, clientes e dinheiro', 'no seu celular.'],
        'small': 'Feito pra profissional brasileira nos EUA',
    },
    'workpro': {
        'symbol': symbol_workpro,
        'icon_k': 1.05,          # prancheta é mais estreita que o calendário
        'grad': (NAVY_TOP, NAVY_DEEP),
        'shadow': NAVY_SHADOW,
        'assets': ASSETS / 'workpro',
        'store': STORE / 'workpro',
        'title': 'WorkPro',
        'lines': ['Orçamento, fatura e agenda', 'direto do celular.'],
        'small': 'Feito pro profissional brasileiro nos EUA',
    },
}
AGENDA = STYLES['agendapro']


def make_icon(size=1024, st=AGENDA):
    """Ícone cheio: fundo da cor do app (gradiente leve), sombra e símbolo."""
    W = size * SS
    bg = gradient((W, W), *st['grad']).convert('RGBA')
    s = size / 1024
    layer, body = st['symbol']((size, size), st['icon_k'] * s, (size / 2, size / 2 + 2 * s))
    bg.alpha_composite(shadow_from(body, 18 * s, 26 * s, 0.38, st['shadow']))
    bg.alpha_composite(layer)
    return down(bg, (size, size)).convert('RGB')


def make_adaptive(size=1024, st=AGENDA):
    """Primeiro plano do ícone adaptável do Android: símbolo dentro da zona segura
    (círculo de ~61% do canvas). Fundo transparente."""
    layer, _ = st['symbol']((size, size), 0.76 * size / 1024, (size / 2, size / 2))
    return down(layer, (size, size))


def make_splash(size=1024, st=AGENDA):
    """Símbolo num quadrado arredondado da cor do app; cabe no círculo da splash do Android 12+."""
    W = size * SS
    img = Image.new('RGBA', (W, W), (0, 0, 0, 0))
    side = 560 * size / 1024
    o = (size - side) / 2
    tile = gradient((W, W), *st['grad']).convert('RGBA')
    m = Image.new('L', (W, W), 0)
    ImageDraw.Draw(m).rounded_rectangle((o * SS, o * SS, (o + side) * SS, (o + side) * SS), radius=140 * size / 1024 * SS, fill=255)
    img.paste(tile, (0, 0), m)
    layer, _ = st['symbol']((size, size), 0.56 * size / 1024, (size / 2, size / 2 + 2 * size / 1024))
    img.alpha_composite(layer)
    return down(img, (size, size))


def make_favicon(size=48, st=AGENDA):
    """Ícone reduzido com cantos arredondados transparentes."""
    big = make_icon(512, st).convert('RGBA')
    m = Image.new('L', (512 * SS, 512 * SS), 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, 512 * SS - 1, 512 * SS - 1), radius=112 * SS, fill=255)
    big.putalpha(down(m, (512, 512)))
    return down(big, (size, size))


def font(names, px):
    for n in names:
        for p in (Path('C:/Windows/Fonts') / n, Path('/usr/share/fonts/truetype/dejavu') / n, Path('/Library/Fonts') / n):
            if p.exists():
                return ImageFont.truetype(str(p), px)
    try:
        return ImageFont.load_default(px)
    except TypeError:
        return ImageFont.load_default()


def make_feature_graphic(w=1024, h=500, st=AGENDA):
    """Gráfico de destaque do Google Play: símbolo à esquerda, nome e frase à direita."""
    W, H = w * SS, h * SS
    img = gradient((W, H), *st['grad']).convert('RGBA')
    # Faixa fina verde-amarela embaixo (mesma ideia do site)
    d = ImageDraw.Draw(img)
    d.rectangle((0, H - 10 * SS, W * 0.6, H), fill=FLAG + (255,))
    d.rectangle((W * 0.6, H - 10 * SS, W, H), fill=(255, 215, 0, 255))

    layer, body = st['symbol']((w, h), 0.48, (215, h / 2))
    img.alpha_composite(shadow_from(body, 10, 16, 0.35, st['shadow']))
    img.alpha_composite(layer)

    title = font(['georgiab.ttf', 'DejaVuSerif-Bold.ttf', 'Georgia Bold.ttf'], 96 * SS)
    sub = font(['seguisb.ttf', 'segoeui.ttf', 'DejaVuSans.ttf', 'Arial.ttf'], 34 * SS)
    small = font(['segoeui.ttf', 'DejaVuSans.ttf', 'Arial.ttf'], 26 * SS)
    x = 410 * SS
    d.text((x, 128 * SS), st['title'], font=title, fill=CREAM + (255,))
    d.text((x, 262 * SS), st['lines'][0], font=sub, fill=CREAM + (255,))
    d.text((x, 306 * SS), st['lines'][1], font=sub, fill=CREAM + (255,))
    d.text((x, 372 * SS), st['small'], font=small, fill=(222, 191, 112, 255))
    return down(img, (w, h)).convert('RGB')


def build(variant, out_root=None):
    """Gera os 6 arquivos de um app. out_root: grava em outra pasta (pra conferir sem sobrescrever)."""
    st = STYLES[variant]
    assets = Path(out_root) / variant / 'assets' if out_root else st['assets']
    store = Path(out_root) / variant / 'store' if out_root else st['store']
    assets.mkdir(parents=True, exist_ok=True)
    store.mkdir(parents=True, exist_ok=True)
    files = [
        (assets / 'icon.png', lambda: make_icon(1024, st)),
        (assets / 'adaptive-icon.png', lambda: make_adaptive(1024, st)),
        (assets / 'splash-icon.png', lambda: make_splash(1024, st)),
        (assets / 'favicon.png', lambda: make_favicon(48, st)),
        # Google Play pede PNG 32 bits (com canal alfa), mesmo opaco
        (store / 'play-icon-512.png', lambda: make_icon(512, st).convert('RGBA')),
        (store / 'play-feature-graphic.png', lambda: make_feature_graphic(1024, 500, st)),
    ]
    for path, fn in files:
        fn().save(path, optimize=True)
        im = Image.open(path)
        try:
            shown = path.relative_to(ROOT)
        except ValueError:
            shown = path
        print(f'ok {variant} {shown} {im.size[0]}x{im.size[1]} {im.mode}')


def main(argv):
    out_root = None
    if '--out' in argv:
        i = argv.index('--out')
        if i + 1 >= len(argv):
            sys.exit('uso: python scripts/make-icons.py [agendapro|workpro] [--out PASTA]')
        out_root = argv[i + 1]
        argv = argv[:i] + argv[i + 2:]
    wanted = [a for a in argv if not a.startswith('-')]
    for v in wanted:
        if v not in STYLES:
            sys.exit(f'variante desconhecida: {v} (use agendapro ou workpro)')
    for v in (wanted or list(STYLES)):
        build(v, out_root)


if __name__ == '__main__':
    main(sys.argv[1:])
