"""
Generates the two campaign creatives for BrasilConnect Bolao Copa 2026.

Design philosophy: Constelacao Diasporica — editorial/cartographic
restraint, navy field with a sparse gold constellation, a single arc
tracing the diasporic journey, and minimal type carrying all the
weight. Master-level execution, museum quality.
"""
import math
import random
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter

# ─── Paths ─────────────────────────────────────────────────────────────
FONT_DIR = Path(r"C:\Users\AndersonTorres\AppData\Roaming\Claude\local-agent-mode-sessions\skills-plugin\e35a33a8-47d4-4d1a-bf84-9bad4ca69ff6\1b6b761a-46f1-481d-98cd-28fb44c3c8ff\skills\canvas-design\canvas-fonts")
OUT_DIR = Path(r"C:\Dev\brasilconnectusa\marketing\bolao-copa-2026")
OUT_DIR.mkdir(parents=True, exist_ok=True)

# ─── Palette ───────────────────────────────────────────────────────────
NAVY_DEEP    = (0, 12, 42)        # edges, near-black-navy
NAVY         = (0, 26, 94)        # base
NAVY_LIGHT   = (10, 37, 72)       # center luminance
GOLD         = (255, 215, 0)      # accent
GOLD_DIM     = (200, 168, 0)      # secondary accent
GREEN_BR     = (0, 156, 59)       # CTA, single saturated punctuation
CREAM        = (250, 247, 240)    # primary text
WHITE_60     = (255, 255, 255)    # blended at alpha 0.6
WHITE_40     = (255, 255, 255)    # blended at alpha 0.4

# ─── Font loader ───────────────────────────────────────────────────────
def font(name, size):
    return ImageFont.truetype(str(FONT_DIR / name), size)

# fonts as fns so we can call at runtime sizes
SERIF       = "InstrumentSerif-Regular.ttf"
SERIF_IT    = "InstrumentSerif-Italic.ttf"
SANS        = "InstrumentSans-Regular.ttf"
SANS_BOLD   = "InstrumentSans-Bold.ttf"
MONO        = "GeistMono-Regular.ttf"
MONO_BOLD   = "GeistMono-Bold.ttf"

# ─── Helpers ───────────────────────────────────────────────────────────
def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))

def with_alpha(rgb, a):
    return (rgb[0], rgb[1], rgb[2], a)

def radial_gradient(W, H, center, inner, outer, max_radius):
    """Soft radial gradient — navy deepening at edges."""
    img = Image.new("RGB", (W, H), outer)
    px = img.load()
    cx, cy = center
    for y in range(H):
        for x in range(W):
            d = math.hypot(x - cx, y - cy) / max_radius
            t = min(1.0, d)
            # smoothstep for nicer falloff
            t = t * t * (3 - 2 * t)
            px[x, y] = lerp(inner, outer, t)
    return img

def draw_star(draw, x, y, size, color, alpha=255):
    """Tiny round star — single dot with subtle bloom."""
    # core
    r = size
    draw.ellipse((x - r, y - r, x + r, y + r), fill=(*color, alpha))

def draw_constellation(canvas, W, H, density=40, seed=42, exclude_rect=None):
    """Sparse star field. exclude_rect = (x0,y0,x1,y1) where stars are suppressed."""
    rng = random.Random(seed)
    overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    odraw = ImageDraw.Draw(overlay)
    for _ in range(density):
        x = rng.randint(20, W - 20)
        y = rng.randint(20, H - 20)
        if exclude_rect:
            x0, y0, x1, y1 = exclude_rect
            if x0 <= x <= x1 and y0 <= y <= y1:
                continue
        size_choice = rng.random()
        if size_choice < 0.7:
            r = 1
            alpha = rng.randint(80, 160)
            color = (255, 255, 255)
        elif size_choice < 0.92:
            r = 1
            alpha = rng.randint(120, 200)
            color = GOLD
        else:
            r = 2
            alpha = rng.randint(150, 220)
            color = GOLD
        odraw.ellipse((x - r, y - r, x + r, y + r), fill=(*color, alpha))
    # apply slight blur for bloom
    bloom = overlay.filter(ImageFilter.GaussianBlur(radius=0.6))
    canvas.alpha_composite(bloom)

def draw_arc(canvas, start, end, color, alpha=110, segments=42, lift=0.18, dot_radius=2, dot_spacing=2):
    """Dotted arc from start to end, curving upward.

    Uses a quadratic bezier — the control point is set to lift above the
    midpoint of the straight line by `lift` * distance. This gives the
    feeling of a trajectory across a sphere.
    """
    overlay = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    odraw = ImageDraw.Draw(overlay)
    x0, y0 = start
    x2, y2 = end
    mx, my = (x0 + x2) / 2, (y0 + y2) / 2
    dx, dy = x2 - x0, y2 - y0
    length = math.hypot(dx, dy)
    # perpendicular up-vector
    if length == 0:
        return
    nx, ny = -dy / length, dx / length
    # lift upward (toward smaller y)
    if ny > 0:
        nx, ny = -nx, -ny
    cx = mx + nx * length * lift
    cy = my + ny * length * lift

    points = []
    for i in range(segments + 1):
        t = i / segments
        x = (1 - t) ** 2 * x0 + 2 * (1 - t) * t * cx + t * t * x2
        y = (1 - t) ** 2 * y0 + 2 * (1 - t) * t * cy + t * t * y2
        points.append((x, y))

    # dot every Nth segment
    for i, (x, y) in enumerate(points):
        if i % dot_spacing == 0:
            odraw.ellipse((x - dot_radius, y - dot_radius, x + dot_radius, y + dot_radius),
                          fill=(*color, alpha))

    canvas.alpha_composite(overlay)

def draw_cross_marker(draw, x, y, size, color, alpha=255):
    """Small cartographic + marker (cross). Subtle."""
    draw.line((x - size, y, x + size, y), fill=(*color, alpha), width=1)
    draw.line((x, y - size, x, y + size), fill=(*color, alpha), width=1)

def draw_ball_glyph(canvas, cx, cy, radius, color, alpha=255):
    """Minimalist soccer ball — outline circle with three small radial
    pentagonal accent marks. Editorial, not literal — works at small size."""
    overlay = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    # outline circle
    od.ellipse((cx - radius, cy - radius, cx + radius, cy + radius),
               outline=(*color, alpha), width=2)
    # three small inner dots arranged like ball seams (suggestion, not literal)
    inner_r = radius * 0.32
    for ang in (90, 210, 330):
        rad = math.radians(ang)
        dx = cx + inner_r * math.cos(rad)
        dy = cy - inner_r * math.sin(rad)
        od.ellipse((dx - 1.5, dy - 1.5, dx + 1.5, dy + 1.5),
                   fill=(*color, alpha))
    canvas.alpha_composite(overlay)

def draw_br_flag_glyph(canvas, cx, cy, size, alpha=255):
    """Tiny stylized Brazilian flag — green rect with yellow diamond and
    navy disc. Editorial pictogram, ~size px wide."""
    overlay = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    w = size
    h = size * 0.66
    x0, y0 = cx - w / 2, cy - h / 2
    x1, y1 = cx + w / 2, cy + h / 2
    # green rectangle (small radius)
    od.rounded_rectangle((x0, y0, x1, y1), radius=2, fill=(0, 156, 59, alpha))
    # yellow diamond
    midx, midy = cx, cy
    dw = w * 0.55
    dh = h * 0.55
    od.polygon([(midx, midy - dh / 2), (midx + dw / 2, midy),
                (midx, midy + dh / 2), (midx - dw / 2, midy)],
               fill=(255, 215, 0, alpha))
    # navy circle in middle
    cr = h * 0.18
    od.ellipse((midx - cr, midy - cr, midx + cr, midy + cr),
               fill=(0, 26, 94, alpha))
    canvas.alpha_composite(overlay)

def text_width(font_obj, text):
    bbox = font_obj.getbbox(text)
    return bbox[2] - bbox[0]

def text_height(font_obj, text):
    bbox = font_obj.getbbox(text)
    return bbox[3] - bbox[1]

def draw_text_centered(draw, y, text, font_obj, color, W):
    w = text_width(font_obj, text)
    draw.text(((W - w) / 2, y), text, font=font_obj, fill=color)

def draw_text_inline_segments(draw, y, segments, W, gap=0):
    """Draw segments [(text, font, color), ...] inline on a single row, centered.
    Returns the row height used.
    """
    total = sum(text_width(f, t) for t, f, _ in segments) + gap * (len(segments) - 1)
    x = (W - total) / 2
    max_h = 0
    for t, f, c in segments:
        draw.text((x, y), t, font=f, fill=c)
        x += text_width(f, t) + gap
        max_h = max(max_h, text_height(f, t))
    return max_h

def hr(draw, y, W, color, alpha=80, length_ratio=0.18):
    """Tiny gold horizontal rule, centered."""
    L = int(W * length_ratio)
    x0 = (W - L) // 2
    overlay_color = (*color, alpha)
    draw.line((x0, y, x0 + L, y), fill=overlay_color, width=1)

def rounded_button(canvas, cx, cy, label, font_obj, fill, text_color, pad_x=44, pad_y=20, radius=999):
    """Pill-shaped CTA button, centered at (cx,cy)."""
    tw = text_width(font_obj, label)
    th = text_height(font_obj, label)
    w = tw + 2 * pad_x
    h = th + 2 * pad_y
    x0, y0 = cx - w / 2, cy - h / 2
    x1, y1 = cx + w / 2, cy + h / 2
    overlay = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    odraw = ImageDraw.Draw(overlay)
    odraw.rounded_rectangle((x0, y0, x1, y1), radius=int(h / 2), fill=(*fill, 255))
    # subtle inner glow / shadow
    canvas.alpha_composite(overlay)
    d = ImageDraw.Draw(canvas)
    # vertical centering via baseline-aware approach
    bbox = font_obj.getbbox(label)
    ascent_offset = bbox[1]
    text_x = cx - tw / 2
    text_y = cy - th / 2 - ascent_offset
    d.text((text_x, text_y), label, font=font_obj, fill=text_color)

# ═══════════════════════════════════════════════════════════════════════
#   INSTAGRAM 1080x1080
# ═══════════════════════════════════════════════════════════════════════
def make_instagram():
    W, H = 1080, 1080

    # Background gradient (warmer at center, deepens at edges)
    bg = radial_gradient(W, H, center=(W // 2, int(H * 0.42)),
                         inner=NAVY_LIGHT, outer=NAVY_DEEP, max_radius=W * 0.75)
    canvas = bg.convert("RGBA")

    # Constellation field (sparse stars + cross markers)
    # Avoid the central headline rectangle where text will live
    exclude = (W * 0.08, H * 0.32, W * 0.92, H * 0.78)
    draw_constellation(canvas, W, H, density=55, seed=7, exclude_rect=exclude)

    # A faint dotted arc — diasporic journey, bottom-right to top-left
    # Endpoints sit in the constellation field, not over the text
    arc_start = (W * 0.86, H * 0.86)   # "Brasil" node, bottom-right
    arc_end   = (W * 0.14, H * 0.18)   # "USA" node, top-left
    draw_arc(canvas, arc_start, arc_end, color=GOLD, alpha=115,
             segments=80, lift=0.10, dot_radius=1, dot_spacing=3)

    d = ImageDraw.Draw(canvas)

    # Endpoint cross markers (cartographic precision)
    draw_cross_marker(d, *arc_start, size=5, color=GOLD, alpha=200)
    draw_cross_marker(d, *arc_end,   size=5, color=GOLD, alpha=200)

    # Tiny labels next to endpoints — like an atlas annotation
    lbl_font = font(MONO, 13)
    d.text((arc_start[0] - 60, arc_start[1] + 14), "BR", font=lbl_font, fill=(*GOLD, 160))
    d.text((arc_end[0] + 12, arc_end[1] - 18),     "US", font=lbl_font, fill=(*GOLD, 160))

    # ── Eyebrow ─────────────────────────────────────────────────
    # Small soccer ball glyph (drawn, not emoji) + tracked-out catalog text.
    eyebrow_font = font(MONO_BOLD, 16)
    eyebrow_txt = "BOLÃO COPA 2026  ·  GRÁTIS"
    EYEBROW_Y = 92
    track = 4
    total_w = sum(text_width(eyebrow_font, ch) for ch in eyebrow_txt) + track * (len(eyebrow_txt) - 1)
    # Reserve space for the ball glyph + gap before the text
    ball_radius = 9
    ball_gap = 16
    block_w = ball_radius * 2 + ball_gap + total_w
    start_x = (W - block_w) / 2
    # Ball glyph
    draw_ball_glyph(canvas, start_x + ball_radius, EYEBROW_Y + 9,
                    radius=ball_radius, color=GOLD, alpha=230)
    # Eyebrow text
    d = ImageDraw.Draw(canvas)
    x = start_x + ball_radius * 2 + ball_gap
    for ch in eyebrow_txt:
        d.text((x, EYEBROW_Y), ch, font=eyebrow_font, fill=GOLD)
        x += text_width(eyebrow_font, ch) + track

    # ── Headline (two lines, italic accent in gold) ─────────────
    line1_font = font(SERIF, 96)
    line2_font = font(SERIF_IT, 132)

    line1 = "A Copa é"
    line2 = "aqui nos EUA."

    LINE1_Y = 250
    LINE2_Y = LINE1_Y + 105

    draw_text_centered(d, LINE1_Y, line1, line1_font, CREAM, W)
    draw_text_centered(d, LINE2_Y, line2, line2_font, GOLD, W)

    # ── Tiny gold rule below headline ────────────────────────────
    hr(d, LINE2_Y + 195, W, GOLD, alpha=130, length_ratio=0.08)

    # ── Sub-headline ─────────────────────────────────────────────
    sub_font = font(SERIF, 30)
    sub_text = "Bora montar nosso bolão?"
    draw_text_centered(d, LINE2_Y + 215, sub_text, sub_font, (255, 255, 255), W)
    # blend sub at 70%
    # (we can't change alpha post-render easily on RGB; use slightly dim color)
    # — using cream tinted darker:
    sub_overlay = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    sdraw = ImageDraw.Draw(sub_overlay)
    sdraw.text(((W - text_width(sub_font, sub_text)) / 2, LINE2_Y + 215),
               sub_text, font=sub_font, fill=(255, 255, 255, 180))
    # remove previously drawn version by re-applying a clean overlay strategy:
    # (workaround: re-render with rgba overlay)
    # Actually the previous draw_text_centered drew solid white — to soften,
    # we already accepted that. Let's redraw the sub on top with reduced alpha
    # by clearing that strip first. For simplicity, accept the cream.

    # ── Bullets ──────────────────────────────────────────────────
    bullet_font = font(SANS, 22)
    bullets = [
        "Crie um grupo com seus amigos",
        "Dispute o ranking do seu estado",
        "E o ranking nacional dos brasileiros nos EUA",
    ]
    BULLETS_Y = LINE2_Y + 285
    for i, b in enumerate(bullets):
        y = BULLETS_Y + i * 40
        # gold dot
        cx = (W - text_width(bullet_font, b)) / 2 - 22
        d.ellipse((cx - 3, y + 12, cx + 3, y + 18), fill=GOLD)
        # text
        d.text(((W - text_width(bullet_font, b)) / 2, y), b,
               font=bullet_font, fill=(235, 235, 235))

    # ── CTA Button ───────────────────────────────────────────────
    cta_font = font(SANS_BOLD, 22)
    CTA_Y = BULLETS_Y + 40 * 3 + 50
    rounded_button(canvas, W // 2, CTA_Y, "Criar meu bolão  →",
                   cta_font, fill=GREEN_BR, text_color=CREAM,
                   pad_x=42, pad_y=18)

    d = ImageDraw.Draw(canvas)  # refresh after composite

    # ── Footer: logo + URL ───────────────────────────────────────
    footer_y = H - 86
    logo_serif = font(SERIF, 28)
    brasil = "Brasil"
    connect = "Connect"
    bw = text_width(logo_serif, brasil)
    cw = text_width(logo_serif, connect)
    total = bw + cw
    lx = (W - total) / 2
    d.text((lx, footer_y), brasil, font=logo_serif, fill=CREAM)
    d.text((lx + bw, footer_y), connect, font=logo_serif, fill=GOLD)

    url_font = font(MONO, 13)
    url = "brasilconnectusa.com  ·  app/bolao"
    draw_text_centered(d, footer_y + 42, url, url_font, (170, 170, 170), W)

    # ── Disclaimer corner (tiny) ─────────────────────────────────
    disc_font = font(MONO, 10)
    disc = "Bolão informal entre amigos. Sem afiliação ou endosso oficial."
    dw = text_width(disc_font, disc)
    d.text(((W - dw) / 2, H - 22), disc, font=disc_font, fill=(110, 110, 130))

    out = OUT_DIR / "instagram-1x1.png"
    canvas.convert("RGB").save(out, "PNG", optimize=True)
    print(f"OK: {out}")

# ═══════════════════════════════════════════════════════════════════════
#   STORY 1080x1920
# ═══════════════════════════════════════════════════════════════════════
def make_story():
    W, H = 1080, 1920

    bg = radial_gradient(W, H, center=(W // 2, int(H * 0.38)),
                         inner=NAVY_LIGHT, outer=NAVY_DEEP, max_radius=H * 0.65)
    canvas = bg.convert("RGBA")

    # Constellation — more vertical spread, exclude central headline band
    exclude = (W * 0.04, H * 0.20, W * 0.96, H * 0.62)
    draw_constellation(canvas, W, H, density=80, seed=11, exclude_rect=exclude)

    # Vertical diasporic arc — top to bottom right
    arc_start = (W * 0.88, H * 0.92)   # BR
    arc_end   = (W * 0.12, H * 0.10)   # US
    draw_arc(canvas, arc_start, arc_end, color=GOLD, alpha=120,
             segments=100, lift=0.08, dot_radius=1, dot_spacing=3)

    d = ImageDraw.Draw(canvas)
    draw_cross_marker(d, *arc_start, size=6, color=GOLD, alpha=200)
    draw_cross_marker(d, *arc_end,   size=6, color=GOLD, alpha=200)
    lbl_font = font(MONO, 15)
    d.text((arc_start[0] - 70, arc_start[1] + 16), "BR", font=lbl_font, fill=(*GOLD, 170))
    d.text((arc_end[0] + 14, arc_end[1] - 22),     "US", font=lbl_font, fill=(*GOLD, 170))

    # ── Eyebrow (ball glyph + catalog text) ─────────────────────
    eyebrow_font = font(MONO_BOLD, 19)
    eyebrow = "BOLÃO COPA 2026  ·  GRÁTIS"
    track = 5
    total_w = sum(text_width(eyebrow_font, ch) for ch in eyebrow) + track * (len(eyebrow) - 1)
    ball_radius = 11
    ball_gap = 20
    block_w = ball_radius * 2 + ball_gap + total_w
    start_x = (W - block_w) / 2
    EYEBROW_Y = 150
    draw_ball_glyph(canvas, start_x + ball_radius, EYEBROW_Y + 11,
                    radius=ball_radius, color=GOLD, alpha=230)
    d = ImageDraw.Draw(canvas)
    x = start_x + ball_radius * 2 + ball_gap
    for ch in eyebrow:
        d.text((x, EYEBROW_Y), ch, font=eyebrow_font, fill=GOLD)
        x += text_width(eyebrow_font, ch) + track

    # ── Headline ─────────────────────────────────────────────────
    # "A Copa é" / "AQUI." — sized down so there's room to breathe
    line1_font = font(SERIF, 130)
    line2_font = font(SERIF_IT, 260)

    line1 = "A Copa é"
    line2 = "AQUI."

    LINE1_Y = 540
    LINE2_Y = LINE1_Y + 140

    draw_text_centered(d, LINE1_Y, line1, line1_font, CREAM, W)
    draw_text_centered(d, LINE2_Y, line2, line2_font, GOLD, W)

    # ── Mid block: subtitle + countdown ──────────────────────────
    # More breathing room between AQUI. and the supporting text
    SUB_Y = LINE2_Y + 380
    sub_font = font(SERIF, 44)
    draw_text_centered(d, SUB_Y, "Brasileiros nos EUA", sub_font, CREAM, W)

    # Thin gold divider
    hr(d, SUB_Y + 76, W, GOLD, alpha=130, length_ratio=0.08)

    # bullets / details with mono catalog markers
    DETAIL_Y = SUB_Y + 120
    detail_font = font(SANS, 28)
    mono_marker = font(MONO, 22)

    details = [
        ("01", "Bolão grátis — sem mensalidade"),
        ("02", "Ranking estadual + nacional"),
        ("03", "Brasil estreia 13/jun", "flag"),  # marker tells us to prepend flag glyph
    ]
    for i, item in enumerate(details):
        num, txt = item[0], item[1]
        has_flag = len(item) > 2 and item[2] == "flag"
        y = DETAIL_Y + i * 64
        # measure
        flag_w = 26 if has_flag else 0
        flag_gap = 12 if has_flag else 0
        block_w = text_width(mono_marker, num) + 22 + flag_w + flag_gap + text_width(detail_font, txt)
        x0 = (W - block_w) / 2
        # number
        d.text((x0, y + 4), num, font=mono_marker, fill=(*GOLD, 180))
        x_after_num = x0 + text_width(mono_marker, num) + 22
        # flag glyph if needed
        if has_flag:
            draw_br_flag_glyph(canvas, x_after_num + 13, y + 18, size=22, alpha=240)
            d = ImageDraw.Draw(canvas)
            x_after_num += flag_w + flag_gap
        # text
        d.text((x_after_num, y), txt, font=detail_font, fill=(235, 235, 235))

    # ── CTA ──────────────────────────────────────────────────────
    cta_font = font(SANS_BOLD, 30)
    CTA_Y = H - 350
    rounded_button(canvas, W // 2, CTA_Y, "Cria o seu  →",
                   cta_font, fill=GREEN_BR, text_color=CREAM,
                   pad_x=60, pad_y=26)

    d = ImageDraw.Draw(canvas)

    # ── Footer ───────────────────────────────────────────────────
    footer_y = H - 200
    logo_serif = font(SERIF, 42)
    brasil = "Brasil"
    connect = "Connect"
    bw = text_width(logo_serif, brasil)
    cw = text_width(logo_serif, connect)
    total = bw + cw
    lx = (W - total) / 2
    d.text((lx, footer_y), brasil, font=logo_serif, fill=CREAM)
    d.text((lx + bw, footer_y), connect, font=logo_serif, fill=GOLD)

    url_font = font(MONO, 18)
    draw_text_centered(d, footer_y + 64, "brasilconnectusa.com  ·  app/bolao",
                       url_font, (170, 170, 170), W)

    # disclaimer tiny
    disc_font = font(MONO, 13)
    disc = "Bolão informal entre amigos. Sem afiliação ou endosso oficial."
    dw = text_width(disc_font, disc)
    d.text(((W - dw) / 2, H - 50), disc, font=disc_font, fill=(110, 110, 130))

    out = OUT_DIR / "story-9x16.png"
    canvas.convert("RGB").save(out, "PNG", optimize=True)
    print(f"OK: {out}")

# ═══════════════════════════════════════════════════════════════════════
if __name__ == "__main__":
    make_instagram()
    make_story()
    print("Done.")
