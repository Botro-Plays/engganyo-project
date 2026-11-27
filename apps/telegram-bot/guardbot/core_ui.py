"""Hand-written translations of the words every screen uses (Italian, Spanish, Portuguese).

They are merged over the machine-translated tables in ``locales/*.json`` so the buttons people press all day
(Back, Close, Main Menu, the Main menu keys, Support …) are always correct and short enough for a button.
Keys are the English label *without* its emoji.
"""
from __future__ import annotations

import re

_ROWS = [
    # english                    it                        es                         pt
    ("Back",                    "Indietro",               "Atrás",                   "Voltar"),
    ("Close",                   "Chiudi",                 "Cerrar",                  "Fechar"),
    ("Main Menu",               "Menu Principale",        "Menú Principal",          "Menu Principal"),
    ("Main menu",               "Menu Principale",        "Menú Principal",          "Menu Principal"),
    ("More",                    "Altro",                  "Más",                     "Mais"),
    ("Next",                    "Avanti",                 "Siguiente",               "Seguinte"),
    ("Previous",                "Precedente",             "Anterior",                "Anterior"),
    ("Cancel",                  "Annulla",                "Cancelar",                "Cancelar"),
    ("Confirm",                 "Conferma",               "Confirmar",               "Confirmar"),
    ("Save",                    "Salva",                  "Guardar",                 "Guardar"),
    ("Done",                    "Fatto",                  "Listo",                   "Feito"),
    ("Yes",                     "Sì",                     "Sí",                      "Sim"),
    ("No",                      "No",                     "No",                      "Não"),
    ("On",                      "Attivo",                 "Activo",                  "Ativo"),
    ("Off",                     "Spento",                 "Apagado",                 "Desligado"),
    ("Delete",                  "Elimina",                "Eliminar",                "Apagar"),
    ("Edit",                    "Modifica",               "Editar",                  "Editar"),
    ("Preview",                 "Anteprima",              "Vista Previa",            "Pré-visualizar"),
    ("Settings",                "Impostazioni",           "Ajustes",                 "Definições"),
    ("Language",                "Lingua",                 "Idioma",                  "Idioma"),
    ("Guide",                   "Guida",                  "Guía",                    "Guia"),
    ("Support",                 "Supporto",               "Soporte",                 "Suporte"),
    ("My Profile",              "Il Mio Profilo",         "Mi Perfil",               "O Meu Perfil"),
    ("My Communities",          "Le Mie Community",       "Mis Comunidades",         "Minhas Comunidades"),
    ("Communities",             "Community",              "Comunidades",             "Comunidades"),
    ("My Bots",                 "I Miei Bot",             "Mis Bots",                "Meus Bots"),
    ("Admin",                   "Admin",                  "Admin",                   "Admin"),
    ("Start Studio",            "Studio Start",           "Estudio Start",           "Estúdio Start"),
    ("Add Me to a Group",       "Aggiungimi a un Gruppo", "Añádeme a un Grupo",      "Adiciona-me a um Grupo"),
    ("Add Me",                  "Aggiungimi",             "Añádeme",                 "Adiciona-me"),
    ("Engganyo.com Support",    "Supporto Engganyo.com",  "Soporte Engganyo.com",    "Suporte Engganyo.com"),
    ("Email Us",                "Scrivici",               "Escríbenos",              "Escreve-nos"),
    ("Telegram Chat",           "Chat Telegram",          "Chat de Telegram",        "Chat do Telegram"),
    ("Group Settings",          "Impostazioni Gruppo",    "Ajustes del Grupo",       "Definições do Grupo"),
    ("Channel Panel",           "Pannello Canale",        "Panel del Canal",         "Painel do Canal"),
    ("Developer Panel",         "Pannello Sviluppatore",  "Panel de Desarrollo",     "Painel de Programador"),
    ("Help",                    "Aiuto",                  "Ayuda",                   "Ajuda"),
    ("Rules",                   "Regole",                 "Reglas",                  "Regras"),
    ("Welcome",                 "Benvenuto",              "Bienvenida",              "Boas-vindas"),
    ("Goodbye",                 "Addio",                  "Despedida",               "Despedida"),
    ("Reset",                   "Ripristina",             "Restablecer",             "Repor"),
    ("Refresh",                 "Aggiorna",               "Actualizar",              "Atualizar"),
    ("Stats",                   "Statistiche",            "Estadísticas",            "Estatísticas"),
    ("Everyone",                "Tutti",                  "Todos",                   "Todos"),
    ("Nobody",                  "Nessuno",                "Nadie",                   "Ninguém"),
    ("Mute",                    "Silenzia",               "Silenciar",               "Silenciar"),
    ("Kick",                    "Espelli",                "Expulsar",                "Expulsar"),
    ("Ban",                     "Banna",                  "Banear",                  "Banir"),
    ("Warn",                    "Avvisa",                 "Avisar",                  "Avisar"),
    ("Getting started",         "Per iniziare",           "Empezar",                 "Começar"),
    ("Staff chat",              "Chat Staff",             "Chat del Staff",          "Chat da Equipa"),
    ("Roles",                   "Ruoli",                  "Roles",                   "Funções"),
    ("Make your own bot",       "Crea il tuo bot",        "Crea tu propio bot",      "Cria o teu bot"),
    ("Founder",                 "Fondatore",              "Fundador",                "Fundador"),
    ("Co-Founder",              "Co-Fondatore",           "Cofundador",              "Cofundador"),
    ("Moderator",               "Moderatore",             "Moderador",               "Moderador"),
    ("Chat Cleaner",            "Pulitore",               "Limpiador",               "Limpador"),
    ("Muter",                   "Silenziatore",           "Silenciador",             "Silenciador"),
    ("Helper",                  "Aiutante",               "Ayudante",                "Ajudante"),
    ("Free",                    "Libero",                 "Libre",                   "Livre"),
    ("Time Zone",               "Fuso Orario",            "Zona Horaria",            "Fuso Horário"),
]
LANGS = ("it", "es", "pt")
CORE: dict[str, dict[str, str]] = {lg: {r[0]: r[i + 1] for r in _ROWS} for i, lg in enumerate(LANGS)}

# Texts of the screens that every user sees in their own chat (keyed by the English text)
_TEXTS = {
    "👇 Main menu": ("👇 Menu principale", "👇 Menú principal", "👇 Menu principal"),
    "Pick an option…": ("Scegli un'opzione…", "Elige una opción…", "Escolhe uma opção…"),
    "💬 <b>Support</b>\n<blockquote>Questions, ideas or problems? The Engganyo team is one tap away.</blockquote>": (
        "💬 <b>Supporto</b>\n<blockquote>Domande, idee o problemi? Il team Engganyo è a un tocco.</blockquote>",
        "💬 <b>Soporte</b>\n<blockquote>¿Preguntas, ideas o problemas? El equipo de Engganyo está a un toque.</blockquote>",
        "💬 <b>Suporte</b>\n<blockquote>Dúvidas, ideias ou problemas? A equipa Engganyo está a um toque.</blockquote>"),
    "🚀 <b>Add me to a group</b>\n<a href=\"{link}\">Tap here, pick your group, and I will join as admin.</a>\n\nThen come back and press 🏘 <b>My Communities</b>.": (
        "➕ <b>Aggiungimi a un gruppo</b>\n<a href=\"{link}\">Tocca qui, scegli il gruppo e entrerò come admin.</a>\n\nPoi torna qui e premi 🏘 <b>Le Mie Community</b>.",
        "➕ <b>Añádeme a un grupo</b>\n<a href=\"{link}\">Toca aquí, elige tu grupo y entraré como admin.</a>\n\nLuego vuelve y pulsa 🏘 <b>Mis Comunidades</b>.",
        "➕ <b>Adiciona-me a um grupo</b>\n<a href=\"{link}\">Toca aqui, escolhe o grupo e entro como admin.</a>\n\nDepois volta e carrega em 🏘 <b>Minhas Comunidades</b>."),
    "Type your answer…": ("Scrivi la risposta…", "Escribe tu respuesta…", "Escreve a tua resposta…"),
    "↩️ Type your answer, or tap Back.": ("↩️ Scrivi la risposta o tocca Indietro.", "↩️ Escribe tu respuesta o toca Atrás.", "↩️ Escreve a resposta ou toca em Voltar."),
    "🇬🇧 Choose your language": ("🇮🇹 Scegli la tua lingua", "🇪🇸 Elige tu idioma", "🇵🇹 Escolhe o teu idioma"),
}
TEXTS: dict[str, dict[str, str]] = {lg: {k: v[i] for k, v in _TEXTS.items()} for i, lg in enumerate(LANGS)}

from . import core_extra as _extra  # noqa: E402  (Kazakh, Uzbek, Somali, Serbian, Amharic, Kurdish, Sinhala basics)

from . import core_hand as _hand  # noqa: E402  (hand-checked words for the machine-translated languages)

CORE.update(_extra.CORE)
TEXTS.update(_extra.TEXTS)
for _lg, _tbl in _hand.CORE.items():
    CORE.setdefault(_lg, {}).update(_tbl)

# every language-neutral word that marks a "navigation" button, so packing and stale-tap handling work in all languages
NAV_WORDS = ("back", "close", "next", "prev", "previous", "home", "more", "menu", "main menu",
             "indietro", "chiudi", "avanti", "precedente", "altro", "menu principale",
             "atrás", "atras", "volver", "cerrar", "siguiente", "anterior", "más", "mas", "menú principal", "menu",
             "voltar", "fechar", "seguinte", "mais", "menu principal")


def label(lang: str | None, core: str) -> str | None:
    """Translation of a button label (without emoji), or None."""
    return CORE.get(lang or "", {}).get(core)


def text(lang: str | None, english: str) -> str:
    t = TEXTS.get(lang or "", {}).get(english)
    if t:
        return t
    try:  # languages built from locale files: the machine translation of the same text
        from . import lang as _lang
        return _lang._ui.get(lang or "", {}).get(english, english)
    except Exception:  # noqa: BLE001
        return english


def reverse_labels() -> dict[str, str]:
    """translated label (without emoji) -> English label, for every language (used to recognise a tap on the home keys)."""
    out: dict[str, str] = {}
    for tbl in CORE.values():
        for en, loc in tbl.items():
            out[loc] = en
    return out


_LEAD = __import__("re").compile(r"^((?:[^\w<@/#(\[]|️|‍)*)\s*(.*)$", __import__("re").S)


def translate_label(lang: str | None, lbl: str) -> str:
    """'🏘 My Communities' -> '🏘 Le Mie Community' (emoji and state marks stay, the words change)."""
    if not lang or lang not in CORE:
        return lbl
    m = _LEAD.match(lbl.strip())
    pre, core = (m.group(1) or "").strip(), m.group(2)
    new = CORE[lang].get(core)
    if new is None:
        return lbl
    return (pre + " " if pre else "") + new


_REV: dict[str, str] | None = None


def english_of(lbl: str) -> str:
    """Translated home label (any language) -> its English label; unknown labels come back unchanged."""
    global _REV
    if _REV is None:
        _REV = {}
        for lg in CORE:
            for en, loc in CORE[lg].items():
                if en != "Lang":
                    _REV.setdefault(loc.lower(), en)
    m = _LEAD.match(lbl.strip())
    pre, core = (m.group(1) or "").strip(), m.group(2)
    en = _REV.get(core.lower())
    return (pre + " " if pre else "") + en if en else lbl.strip()


# ---------------------------------------------------------------- every language: words learned from the locale files
_RE: dict[str, object] = {}
_GROUPS = {"back": ("Back",), "close": ("Close",), "menu": ("Main Menu", "Main menu", "Menu"), "mainmenu": ("Main Menu", "Main menu"),
           "more": ("More", "Next", "Previous")}


def extend(ui_tables: dict) -> None:
    """Called after the locale files are loaded: languages without hand-written words get the machine translation of them."""
    global _REV
    _REV = None
    _RE.clear()
    for code, tbl in ui_tables.items():
        if code in CORE or not tbl:
            continue
        CORE[code] = {r[0]: tbl[r[0]] for r in _ROWS if r[0] in tbl and tbl[r[0]] != r[0]}
        TEXTS.setdefault(code, {k: tbl[k] for k in _TEXTS if k in tbl})


def _words(group: str) -> list[str]:
    import re
    words = {w.lower() for en in _GROUPS[group] for w in [en]}
    for tbl in CORE.values():
        for en in _GROUPS[group]:
            if en in tbl:
                words.add(tbl[en].lower())
    return sorted((re.escape(w) for w in words if w), key=len, reverse=True)


def _re(name: str, groups: tuple[str, ...], tail: str = r"\b"):
    import re
    if name not in _RE:
        alts = "|".join(w for g in groups for w in _words(g))
        _RE[name] = re.compile(r"^(?:[^\w]*)(?:" + alts + ")" + tail, re.I)
    return _RE[name]


def is_nav(lbl: str) -> bool:
    t = lbl.strip()
    return bool(_re("nav", ("back", "close", "menu"), r"(?:\b|$)").match(t) or _re("navmore", ("more",), "$").match(t)
                or re.match(r"^(?:[^\w]*)(?:next|prev|previous|home|more pages)\b", t, re.I))


def is_back(lbl: str) -> bool:
    """Back or Main Menu in any language (the screen already has a way out)."""
    t = lbl.strip()
    return bool(_re("backs", ("back", "mainmenu"), "").search(t))


def is_close(lbl: str) -> bool:
    return bool(_re("close", ("close",), r"(?:\b|$)").match(lbl.strip()))


def only_back(lbl: str) -> bool:
    return bool(_re("onlyback", ("back",), r"(?:\b|$)").match(lbl.strip()))
