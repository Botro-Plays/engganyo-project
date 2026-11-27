"""Branded picture cards (logo + centred title + short description) drawn with Pillow.

Used for the portal post and for the message people get before they join. Colours and logo come from the
Engganyo brand files (navy 1F3260, gold E8A800, blue 1F62F0); the logo is ``assets/logo.png``.
"""
from __future__ import annotations

import hashlib
import io
import textwrap
from functools import lru_cache
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ASSETS = Path(__file__).resolve().parent.parent / "assets"
NAVY, NAVY_DARK, GOLD, WHITE, SOFT = (31, 50, 96), (14, 24, 52), (232, 168, 0), (255, 249, 236), (190, 205, 235)
BRAND_FONT = ASSETS / "fonts" / "VT323-Regular.ttf"  # the pixel font of the Engganyo brand files


@lru_cache(maxsize=32)
def _font(bold: bool, size: int):
    try:
        return ImageFont.truetype(str(BRAND_FONT), size)
    except OSError:
        return ImageFont.load_default(size=size)


_FALLBACKS = {  # script -> candidate font files (Windows, Linux, macOS, or assets/fonts/fallback-<script>.ttf)
    "latin": ["arialbd.ttf", "DejaVuSans-Bold.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "/System/Library/Fonts/Supplemental/Arial Bold.ttf"],
    "cjk": ["msyhbd.ttc", "YuGothB.ttc", "malgunbd.ttf", "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc", "/usr/share/fonts/truetype/noto/NotoSansCJK-Bold.ttc",
            "/System/Library/Fonts/PingFang.ttc"],
    "hangul": ["malgunbd.ttf", "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc", "/System/Library/Fonts/AppleSDGothicNeo.ttc"],
    "indic": ["NirmalaB.ttf", "Nirmala.ttf", "/usr/share/fonts/truetype/noto/NotoSansDevanagari-Bold.ttf", "/usr/share/fonts/truetype/lohit-devanagari/Lohit-Devanagari.ttf"],
    "ethiopic": ["ebrimabd.ttf", "ebrima.ttf", "NirmalaB.ttf", "/usr/share/fonts/truetype/noto/NotoSansEthiopic-Bold.ttf"],
}
_SCRIPT_RANGES = [("cjk", 0x2E80, 0x9FFF), ("cjk", 0xF900, 0xFAFF), ("hangul", 0xAC00, 0xD7AF), ("hangul", 0x1100, 0x11FF), ("indic", 0x0900, 0x0DFF),
                  ("ethiopic", 0x1200, 0x139F), ("latin", 0x0250, 0x08FF), ("latin", 0x1E00, 0x1FFF)]  # latin = "anything else the pixel font lacks"


def _script_of(text: str) -> str:
    """'pixel' when VT323 can draw the text, else the script family that needs another font."""
    for ch in text:
        c = ord(ch)
        if c > 0x24F and ch not in " '\"":
            for name, lo, hi in _SCRIPT_RANGES:
                if lo <= c <= hi:
                    return name
            return "latin"
    return "pixel"


@lru_cache(maxsize=64)
def _fallback_font(script: str, size: int):
    dirs = [Path("C:/Windows/Fonts"), ASSETS / "fonts"]
    for name in _FALLBACKS.get(script, []) + _FALLBACKS["latin"]:
        for cand in ([Path(name)] if name.startswith("/") else [d / name for d in dirs]):
            if cand.exists():
                try:
                    return ImageFont.truetype(str(cand), size)
                except OSError:
                    continue
    return None


def _font_for(text: str, bold: bool, size: int):
    script = _script_of(text)
    if script != "pixel":
        f = _fallback_font(script, max(8, int(size * 0.8)))  # sans fonts look bigger than the pixel one
        if f is not None:
            return f
    return _font(bold, size)


def _shape(text: str) -> str:
    """Right-to-left scripts (Arabic, Persian, Hebrew, Urdu, Kurdish): join the letters and put them in visual order."""
    if not any(0x0590 <= ord(c) <= 0x08FF or 0xFB1D <= ord(c) <= 0xFEFF for c in text):
        return text
    try:
        import arabic_reshaper
        from bidi.algorithm import get_display
        return get_display(arabic_reshaper.reshape(text))
    except Exception:  # noqa: BLE001
        return text


def _stroke(size: int, bold: bool) -> int:
    return max(1, size // 60) if bold else 0


def _wrap(d: ImageDraw.ImageDraw, text: str, font, maxw: int, stroke: int = 0) -> list[str]:
    words, lines, cur = (text or "").split(), [], ""
    for wd in words:
        t = (cur + " " + wd).strip()
        if d.textlength(_shape(t), font=font) + 2 * stroke <= maxw or not cur:
            cur = t
        else:
            lines.append(cur)
            cur = wd
    if cur:
        lines.append(cur)
    return lines


def _background(w: int, h: int) -> Image.Image:
    bg = Image.new("RGB", (w, h), NAVY_DARK)
    glow = Image.new("L", (w, h), 0)
    ImageDraw.Draw(glow).ellipse((w * 0.15, h * -0.2, w * 0.85, h * 0.9), fill=255)
    glow = glow.filter(ImageFilter.GaussianBlur(h * 0.18))
    return Image.composite(Image.new("RGB", (w, h), NAVY), bg, glow)


def _centered(draw: ImageDraw.ImageDraw, w: int, y: int, text: str, font, fill, stroke: int = 0) -> int:
    text = _shape(text)
    box = draw.textbbox((0, 0), text, font=font, stroke_width=stroke)
    draw.text(((w - (box[2] - box[0])) / 2 - box[0], y - box[1]), text, font=font, fill=fill, stroke_width=stroke, stroke_fill=fill)
    return box[3] - box[1]


def _icon(name: str, size: int) -> Image.Image | None:
    """The brand's own pixel icons (Files/Linktree), scaled with nearest-neighbour so they stay crisp."""
    try:
        im = Image.open(ASSETS / "icons" / f"{name}.png").convert("RGBA")
        return im.resize((size, size), Image.NEAREST)
    except OSError:
        return None


def _footer_size(d: ImageDraw.ImageDraw, w: int, h: int) -> tuple[int, int]:
    f = _font(False, int(h * 0.085))
    wa, wb = d.textlength("engganyo.com", font=f), d.textlength("t.me/Engganyo", font=f)
    r = int(h * 0.075)
    return int(2 * r + 0.3 * r + wa + w * 0.05 + 2 * r + 0.3 * r + wb), 2 * r


def _footer(img: Image.Image, d: ImageDraw.ImageDraw, w: int, cy: int, h: int):
    """[web icon] engganyo.com   [Telegram icon] t.me/Engganyo, centred."""
    f = _font(False, int(h * 0.085))
    r = int(h * 0.075)
    a, b = "engganyo.com", "t.me/Engganyo"
    wa, wb = d.textlength(a, font=f), d.textlength(b, font=f)
    ig, gap = int(r * 0.3), int(w * 0.05)
    total = (2 * r + ig + wa) + gap + (2 * r + ig + wb)
    x = int((w - total) / 2)
    for name, text, col, width in (("website", a, GOLD, wa), ("telegram", b, WHITE, wb)):
        ic = _icon(name, 2 * r)
        if ic:
            img.paste(ic, (x, cy - r), ic)
        d.text((x + 2 * r + ig, cy), text, font=f, fill=col, anchor="lm", stroke_width=1, stroke_fill=col)
        x += int(2 * r + ig + width + gap)


def _clean(text: str) -> str:
    """Keep what the pixel font can draw: curly quotes become straight ones, emoji / flags are dropped."""
    import re
    text = (text or "").replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"')
    text = text.replace("–", "-").replace("-", "-").replace("…", "...")
    text = re.sub(r"[🀀-🫿☀-➿⬀-⯿️‍⃣©®™]", "", text)  # emoji / flags have no glyph
    return re.sub(r"\s+", " ", text).strip()


def _fit_lines(d, text: str, make_font, start: int, minimum: int, maxw: int, max_lines: int, bold: bool):
    """Largest font size (shrinking from ``start``) whose wrapped text fits in ``max_lines`` lines. Nothing is ever cut:
    below the minimum size the text keeps shrinking, and only then does it get extra lines."""
    floor = max(10, minimum // 2)
    for lines_allowed in (max_lines, max_lines + 1, max_lines + 2, max_lines + 4):
        size = start
        while size >= floor:
            f = make_font(size)
            st = _stroke(size, bold)
            lines = _wrap(d, text, f, maxw, st)
            if len(lines) <= lines_allowed and all(d.textlength(_shape(ln), font=f) + 2 * st <= maxw for ln in lines):
                return f, st, lines, size
            size = int(size * 0.94) if size > floor else floor - 1
        if lines_allowed == max_lines:
            floor = max(10, minimum // 3)
    f = make_font(floor)
    return f, _stroke(floor, bold), _wrap(d, text, f, maxw), floor


def render(title: str, desc: str = "", footer: str = "links", size: tuple[int, int] = (800, 450)) -> bytes:
    """JPEG bytes of a card: logo, a title (2 lines at most, auto-sized), a short description and the web / Telegram
    links, all centred in the middle and always inside the picture."""
    title, desc = _clean(title), _clean(desc)
    if not title:
        title = "Engganyo"
    w, h = size
    img = _background(w, h)
    d = ImageDraw.Draw(img)
    maxw = int(w * 0.88)
    g_logo, g_line, g_title, g_desc, g_foot = int(h * 0.035), int(h * 0.02), int(h * 0.04), int(h * 0.022), int(h * 0.05)
    foot_h = 2 * int(h * 0.075) if footer else 0
    lh = int(h * 0.25)
    avail = h - 10 - int(h * 0.05)  # room between the top margin and the gold bar
    tsize, dsize = int(h * 0.21), int(h * 0.092)
    while True:
        tf, st, lines, tsz = _fit_lines(d, title.upper(), lambda s: _font_for(title, True, s), tsize, int(h * 0.10), maxw, 2, True)
        df, _s, dlines, dsz = _fit_lines(d, desc, lambda s: _font_for(desc, False, s), dsize, int(h * 0.058), maxw, 2, False)
        t_heights = [d.textbbox((0, 0), ln, font=tf, stroke_width=st)[3] - d.textbbox((0, 0), ln, font=tf, stroke_width=st)[1] for ln in lines]
        d_heights = [d.textbbox((0, 0), ln, font=df)[3] - d.textbbox((0, 0), ln, font=df)[1] for ln in dlines]
        total = lh + g_logo + sum(t + g_line for t in t_heights) + g_title + sum(t + g_desc for t in d_heights) + (g_foot + foot_h if footer else 0)
        if total <= avail or lh <= int(h * 0.12):
            break
        lh = int(lh * 0.9)  # too tall: the logo gives way first
    y = max(int(h * 0.025), int((h - 10 - total) / 2))
    try:
        logo = Image.open(ASSETS / "logo.png").convert("RGBA").resize((lh, lh), Image.LANCZOS)
        img.paste(logo, ((w - lh) // 2, y), logo)
    except OSError:
        pass
    y += lh + g_logo
    for ln, th in zip(lines, t_heights):
        _centered(d, w, y, ln, tf, WHITE, st)
        y += th + g_line
    y += g_title
    for ln, th in zip(dlines, d_heights):
        _centered(d, w, y, ln, df, SOFT)
        y += th + g_desc
    if footer:
        _footer(img, d, w, y + g_foot + foot_h // 2, h)
    d.rectangle((0, h - 10, w, h), fill=GOLD)
    out = io.BytesIO()
    img.save(out, "JPEG", quality=80, subsampling=1, optimize=True)  # small file: Telegram shows it at once, no download arrow
    return out.getvalue()


def card_for(title: str, desc: str = "", footer: str = "links") -> bytes:
    """Same as render(), cached on disk by content so a busy portal does not redraw the picture each time."""
    key = hashlib.sha1(f"v10|{title}|{desc}|{footer}".encode()).hexdigest()[:16]
    cache = Path(__file__).resolve().parent.parent / "data" / "cards"
    f = cache / f"{key}.jpg"
    if f.exists():
        return f.read_bytes()
    data = render(title, desc, footer)
    try:
        cache.mkdir(parents=True, exist_ok=True)
        f.write_bytes(data)
    except OSError:
        pass
    return data


# ---------------------------------------------------------------- section pictures (one per screen family)
SECTIONS = {  # slug: (title, short description)  - keys are matched against a screen's title (lower case, no emoji)
    "main menu": ("Main Menu", "Everything you need, one tap away."),
    "control panel": ("Group Settings", "Protect, greet and grow your group."),
    "channel panel": ("Channel Panel", "Post, plan and grow your channel."),
    "my communities": ("My Communities", "Your groups and channels in one place."),
    "spam shield": ("Spam Shield", "Stop links, floods and junk before they land."),
    "flood guard": ("Flood Guard", "Calm down fast typers and message storms."),
    "verification": ("Verification", "Only real people get to talk."),
    "join approval": ("Join Approval", "You decide who comes in."),
    "join check": ("Join Check", "A friendly welcome before they join."),
    "greeting": ("Greeting", "Make a great first impression."),
    "goodbye": ("Goodbye", "A kind word when someone leaves."),
    "tag everyone": ("Tag Everyone", "Call the whole group with one tiny emoji."),
    "invite contest": ("Invite Contest", "Who brings the most people? Rank them."),
    "portal": ("Portal", "A verified entrance with one-time links."),
    "announcements": ("Announcements", "Reach every bot, group and chat."),
    "start studio": ("Start Studio", "Design the welcome of your own bot."),
    "developer panel": ("Developer Panel", "Stats, groups, clones and announcements."),
    "guide": ("Guide", "Learn Engganyo in a minute."),
    "support": ("Support", "The Engganyo team is one tap away."),
    "my bots": ("My Bots", "Your own branded copies of Engganyo."),
    "quiet hours": ("Quiet Hours", "Keep the group calm at night."),
    "group rules": ("Group Rules", "Clear rules, a happier group."),
    "auto clean": ("Auto Clean", "Keep the chat tidy by itself."),
    "word filter": ("Word Filter", "Block the words you do not want."),
    "warnings": ("Warnings", "Three strikes and a clear record."),
    "alphabet filter": ("Alphabet Filter", "Allow only the scripts you choose."),
    "adult filter": ("Adult Filter", "Keep it clean for everybody."),
    "media filter": ("Media Filter", "Choose which media is allowed."),
    "mention alerts": ("Mention Alerts", "Tell people when they are mentioned."),
    "member requirements": ("Requirements", "Photo, username and more before talking."),
    "invite link": ("Invite Link", "Share the right link with the right people."),
    "choose your language": ("Language", "Choose your language"),
}


DEFAULT_DESC = "Simple tools. Big communities."


def slug_of(title: str) -> str:
    import re
    t = (title or "").replace("’", "'").replace("‘", "'")
    t = re.sub(r"[^\w\s']", " ", t).strip().lower()
    return re.sub(r"\s+", " ", t)


def _own_title(slug: str, title: str | None) -> str:
    """The screen's own title with its punctuation kept ("Posted in 1 of 1 channel(s)", "Gated post 1/3"); emoji are dropped."""
    import re
    if title:
        t = re.sub(r"[^\w\s'/()\-.,:&!?+#%]", "", title).strip()
        t = re.sub(r"\s+", " ", t)
        if len(t) >= 3:
            return t
    return _cap(slug)


def _cap(slug: str) -> str:
    import string
    return string.capwords(slug)


def section_title(text: str) -> str | None:
    """The picture family of a finished screen, from its title line (any short title gets one), or None."""
    import re
    first = re.sub(r"<[^>]+>", "", (text or "").split(chr(10), 1)[0]).strip()
    slug = slug_of(first)
    if not slug or len(first) > 40 or len(slug) < 3:
        return None
    for k in SECTIONS:
        if slug == k or slug.startswith(k):
            return k
    return slug


def first_line(text: str) -> str:
    import re
    return re.sub(r"<[^>]+>", "", (text or "").split(chr(10), 1)[0]).strip()


def section_card(slug: str, lang: str = "en", title: str | None = None) -> bytes:
    tr = TR.get(lang)
    if tr:  # a translated picture, drawn once and then cached on disk
        if slug in tr:
            t, dsc = tr[slug]
        else:
            t, dsc = SECTIONS.get(slug, (_own_title(slug, title), DEFAULT_DESC))[0], tr["_default"]
            if title:  # the screen's own (translated) title line
                t = title
            try:  # a screen title without a hand-made picture: use the translated menu name when there is one
                from . import lang as _lang
                t = _lang._ui.get(lang, {}).get(t, t)
            except Exception:  # noqa: BLE001
                pass
        return card_for(t, dsc)
    if lang and lang != "en":  # any other language: the machine-translated menu names and descriptions
        try:
            from . import lang as _lang
            table = _lang._ui.get(lang)
        except Exception:  # noqa: BLE001
            table = None
        if table:
            t0, d0 = SECTIONS.get(slug, (None, DEFAULT_DESC))
            t = (table.get(t0) if t0 else None) or title or table.get(_cap(slug)) or _cap(slug)
            return card_for(t, table.get(d0, d0))
    name = slug.replace(" ", "_")
    for f in (ASSETS / "cards" / (name + ".jpg"), ASSETS / "cards" / "auto" / (name + ".jpg")):
        if f.exists():
            return f.read_bytes()
    t, dsc = SECTIONS.get(slug, (_own_title(slug, title), DEFAULT_DESC))
    return card_for(t, dsc)


# the same pictures in the languages that have message translations (title, description); others fall back to English
_T = {  # key: (it, es, pt) title / description
    "main menu": (("Menu Principale", "Tutto quello che ti serve, a un tocco."), ("Menú Principal", "Todo lo que necesitas, a un toque."), ("Menu Principal", "Tudo o que precisas, a um toque.")),
    "control panel": (("Impostazioni Gruppo", "Proteggi, accogli e fai crescere il gruppo."), ("Ajustes del Grupo", "Protege, saluda y haz crecer tu grupo."), ("Definições do Grupo", "Protege, recebe e faz crescer o grupo.")),
    "channel panel": (("Pannello Canale", "Pubblica, pianifica e fai crescere il canale."), ("Panel del Canal", "Publica, programa y haz crecer tu canal."), ("Painel do Canal", "Publica, agenda e faz crescer o canal.")),
    "my communities": (("Le Mie Community", "Gruppi e canali in un unico posto."), ("Mis Comunidades", "Tus grupos y canales en un solo lugar."), ("As Minhas Comunidades", "Grupos e canais num só lugar.")),
    "spam shield": (("Scudo Spam", "Ferma link, flood e spazzatura."), ("Escudo Spam", "Frena enlaces, floods y basura."), ("Escudo Spam", "Trava links, floods e lixo.")),
    "flood guard": (("Anti Flood", "Calma chi scrive troppo veloce."), ("Anti Flood", "Calma a quien escribe demasiado rápido."), ("Anti Flood", "Acalma quem escreve depressa demais.")),
    "verification": (("Verifica", "Parlano solo persone vere."), ("Verificación", "Solo hablan personas reales."), ("Verificação", "Só pessoas reais falam.")),
    "join approval": (("Approvazione", "Decidi tu chi entra."), ("Aprobación", "Tú decides quién entra."), ("Aprovação", "Tu decides quem entra.")),
    "join check": (("Controllo Ingresso", "Un benvenuto prima di entrare."), ("Control de Entrada", "Una bienvenida antes de entrar."), ("Controlo de Entrada", "Uma boas-vindas antes de entrar.")),
    "greeting": (("Benvenuto", "Una bella prima impressione."), ("Bienvenida", "Una gran primera impresión."), ("Boas-vindas", "Uma ótima primeira impressão.")),
    "goodbye": (("Addio", "Un saluto a chi se ne va."), ("Despedida", "Unas palabras al salir."), ("Despedida", "Uma palavra a quem sai.")),
    "tag everyone": (("Tagga Tutti", "Chiama il gruppo con una piccola emoji."), ("Mencionar a Todos", "Llama al grupo con un pequeño emoji."), ("Marcar Todos", "Chama o grupo com um pequeno emoji.")),
    "invite contest": (("Gara Inviti", "Chi porta più persone? Classifica."), ("Concurso de Invitaciones", "¿Quién trae más gente? Ranking."), ("Concurso de Convites", "Quem traz mais gente? Ranking.")),
    "portal": (("Portale", "Un ingresso verificato con link monouso."), ("Portal", "Una entrada verificada con enlaces de un solo uso."), ("Portal", "Uma entrada verificada com links de uso único.")),
    "announcements": (("Annunci", "Raggiungi ogni bot, gruppo e chat."), ("Anuncios", "Llega a cada bot, grupo y chat."), ("Anúncios", "Chega a cada bot, grupo e chat.")),
    "start studio": (("Studio Start", "Crea il benvenuto del tuo bot."), ("Estudio Start", "Diseña la bienvenida de tu bot."), ("Estúdio Start", "Cria as boas-vindas do teu bot.")),
    "developer panel": (("Pannello Sviluppatore", "Statistiche, gruppi, cloni e annunci."), ("Panel de Desarrollo", "Estadísticas, grupos, clones y anuncios."), ("Painel de Programador", "Estatísticas, grupos, clones e anúncios.")),
    "guide": (("Guida", "Impara Engganyo in un minuto."), ("Guía", "Aprende Engganyo en un minuto."), ("Guia", "Aprende o Engganyo num minuto.")),
    "support": (("Supporto", "Il team Engganyo è a un tocco."), ("Soporte", "El equipo de Engganyo a un toque."), ("Suporte", "A equipa Engganyo a um toque.")),
    "my bots": (("I Miei Bot", "Le tue copie di Engganyo."), ("Mis Bots", "Tus copias de Engganyo."), ("Os Meus Bots", "As tuas cópias do Engganyo.")),
    "quiet hours": (("Ore Silenziose", "Gruppo calmo di notte."), ("Horas de Silencio", "Un grupo tranquilo de noche."), ("Horas de Silêncio", "Um grupo calmo à noite.")),
    "group rules": (("Regole", "Regole chiare, gruppo felice."), ("Reglas", "Reglas claras, grupo feliz."), ("Regras", "Regras claras, grupo feliz.")),
    "auto clean": (("Pulizia Auto", "La chat resta in ordine da sola."), ("Limpieza Auto", "El chat se mantiene ordenado solo."), ("Limpeza Auto", "O chat fica arrumado sozinho.")),
    "word filter": (("Filtro Parole", "Blocca le parole indesiderate."), ("Filtro de Palabras", "Bloquea las palabras que no quieres."), ("Filtro de Palavras", "Bloqueia as palavras que não queres.")),
    "warnings": (("Avvisi", "Tre avvisi e fedina pulita."), ("Avisos", "Tres avisos y expediente limpio."), ("Avisos", "Três avisos e cadastro limpo.")),
    "alphabet filter": (("Filtro Alfabeti", "Solo gli alfabeti che scegli."), ("Filtro de Alfabetos", "Solo los alfabetos que elijas."), ("Filtro de Alfabetos", "Só os alfabetos que escolheres.")),
    "adult filter": (("Filtro Adulti", "Pulito per tutti."), ("Filtro Adulto", "Limpio para todos."), ("Filtro Adulto", "Limpo para todos.")),
    "media filter": (("Filtro Media", "Scegli quali media sono ammessi."), ("Filtro de Medios", "Elige qué medios se permiten."), ("Filtro de Média", "Escolhe que média é permitido.")),
    "mention alerts": (("Avvisi Menzioni", "Avvisa chi viene menzionato."), ("Avisos de Mención", "Avisa a quien es mencionado."), ("Avisos de Menção", "Avisa quem é mencionado.")),
    "member requirements": (("Requisiti", "Foto, username e altro prima di scrivere."), ("Requisitos", "Foto, usuario y más antes de hablar."), ("Requisitos", "Foto, utilizador e mais antes de falar.")),
    "choose your language": (("Lingua", "Scegli la tua lingua"), ("Idioma", "Elige tu idioma"), ("Idioma", "Escolhe o teu idioma")),
    "invite link": (("Link Invito", "Il link giusto alle persone giuste."), ("Enlace de Invitación", "El enlace justo para la gente justa."), ("Link de Convite", "O link certo para as pessoas certas.")),
}
_DEFAULT = {"it": "Strumenti semplici. Grandi community.", "es": "Herramientas simples. Grandes comunidades.", "pt": "Ferramentas simples. Grandes comunidades."}
TR = {lg: {k: v[i] for k, v in _T.items()} for i, lg in enumerate(("it", "es", "pt"))}
for _lg, _d in _DEFAULT.items():
    TR[_lg]["_default"] = _d
