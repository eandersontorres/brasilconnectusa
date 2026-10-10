#!/usr/bin/env python3
# ════════════════════════════════════════════════════════════════════════════
#   Gera os ícones do AgendaPro com PIL (Pillow).
#     python scripts/make-icons.py
#
#   assets/icon.png            1024x1024, sem transparência (App Store / ícone iOS)
#   assets/adaptive-icon.png   1024x1024, só o símbolo, fundo transparente
#                              (app.config usa backgroundColor #1F4D3F no Android)
#   assets/splash-icon.png     1024x1024 transparente, símbolo num quadrado verde
#                              arredondado (a splash é creme #FAF7F0)
#   assets/favicon.png         48x48 (preview web)
#   store/play-icon-512.png    512x512 (ícone de alta resolução do Google Play)
#   store/play-feature-graphic.png 1024x500 (gráfico de destaque do Google Play)
#
#   Desenha em 4x e reduz com LANCZOS (antialias). Símbolo: calendário creme com
#   cabeçalho dourado e um check verde-bandeira.
# ════════════════════════════════════════════════════════════════════════════
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


def shadow_from(mask, offset_px, blur_px, opacity):
    """Sombra suave (4x) a partir de uma máscara."""
    sh = Image.new('L', mask.size, 0)
    sh.paste(mask, (0, round(offset_px * SS)))
    sh = sh.filter(ImageFilter.GaussianBlur(blur_px * SS))
    sh = sh.point(lambda v: int(v * opacity))
    out = Image.new('RGBA', mask.size, SHADOW + (0,))
    out.putalpha(sh)
    return out


def down(img, size):
    return img.resize(size, Image.LANCZOS)


def make_icon(size=1024):
    """Ícone cheio: fundo verde (gradiente leve), sombra e símbolo."""
    W = size * SS
    bg = gradient((W, W), (35, 86, 70), GREEN_DEEP).convert('RGBA')
    s = size / 1024
    layer, body = symbol((size, size), 1.0 * s, (size / 2, size / 2 + 2 * s))
    bg.alpha_composite(shadow_from(body, 18 * s, 26 * s, 0.38))
    bg.alpha_composite(layer)
    return down(bg, (size, size)).convert('RGB')


def make_adaptive(size=1024):
    """Primeiro plano do ícone adaptável do Android: símbolo dentro da zona segura
    (círculo de ~61% do canvas). Fundo transparente."""
    layer, _ = symbol((size, size), 0.76 * size / 1024, (size / 2, size / 2))
    return down(layer, (size, size))


def make_splash(size=1024):
    """Símbolo num quadrado verde arredondado; cabe no círculo da splash do Android 12+."""
    W = size * SS
    img = Image.new('RGBA', (W, W), (0, 0, 0, 0))
    side = 560 * size / 1024
    o = (size - side) / 2
    tile = gradient((W, W), (35, 86, 70), GREEN_DEEP).convert('RGBA')
    m = Image.new('L', (W, W), 0)
    ImageDraw.Draw(m).rounded_rectangle((o * SS, o * SS, (o + side) * SS, (o + side) * SS), radius=140 * size / 1024 * SS, fill=255)
    img.paste(tile, (0, 0), m)
    layer, _ = symbol((size, size), 0.56 * size / 1024, (size / 2, size / 2 + 2 * size / 1024))
    img.alpha_composite(layer)
    return down(img, (size, size))


def make_favicon(size=48):
    """Ícone reduzido com cantos arredondados transparentes."""
    big = make_icon(512).convert('RGBA')
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


def make_feature_graphic(w=1024, h=500):
    """Gráfico de destaque do Google Play: símbolo à esquerda, nome e frase à direita."""
    W, H = w * SS, h * SS
    img = gradient((W, H), (35, 86, 70), GREEN_DEEP).convert('RGBA')
    # Faixa fina verde-amarela embaixo (mesma ideia do site)
    d = ImageDraw.Draw(img)
    d.rectangle((0, H - 10 * SS, W * 0.6, H), fill=FLAG + (255,))
    d.rectangle((W * 0.6, H - 10 * SS, W, H), fill=(255, 215, 0, 255))

    layer, body = symbol((w, h), 0.48, (215, h / 2))
    img.alpha_composite(shadow_from(body, 10, 16, 0.35))
    img.alpha_composite(layer)

    title = font(['georgiab.ttf', 'DejaVuSerif-Bold.ttf', 'Georgia Bold.ttf'], 96 * SS)
    sub = font(['seguisb.ttf', 'segoeui.ttf', 'DejaVuSans.ttf', 'Arial.ttf'], 34 * SS)
    small = font(['segoeui.ttf', 'DejaVuSans.ttf', 'Arial.ttf'], 26 * SS)
    x = 410 * SS
    d.text((x, 128 * SS), 'AgendaPro', font=title, fill=CREAM + (255,))
    d.text((x, 262 * SS), 'Agenda, clientes e dinheiro', font=sub, fill=CREAM + (255,))
    d.text((x, 306 * SS), 'no seu celular.', font=sub, fill=CREAM + (255,))
    d.text((x, 372 * SS), 'Feito pra profissional brasileira nos EUA', font=small, fill=(222, 191, 112, 255))
    return down(img, (w, h)).convert('RGB')


def main():
    ASSETS.mkdir(exist_ok=True)
    STORE.mkdir(exist_ok=True)
    make_icon().save(ASSETS / 'icon.png', optimize=True)
    make_adaptive().save(ASSETS / 'adaptive-icon.png', optimize=True)
    make_splash().save(ASSETS / 'splash-icon.png', optimize=True)
    make_favicon().save(ASSETS / 'favicon.png', optimize=True)
    # Google Play pede PNG 32 bits (com canal alfa), mesmo opaco
    make_icon(512).convert('RGBA').save(STORE / 'play-icon-512.png', optimize=True)
    make_feature_graphic().save(STORE / 'play-feature-graphic.png', optimize=True)
    for p in ['assets/icon.png', 'assets/adaptive-icon.png', 'assets/splash-icon.png', 'assets/favicon.png',
              'store/play-icon-512.png', 'store/play-feature-graphic.png']:
        im = Image.open(ROOT / p)
        print(f'ok {p} {im.size[0]}x{im.size[1]} {im.mode}')


if __name__ == '__main__':
    main()
