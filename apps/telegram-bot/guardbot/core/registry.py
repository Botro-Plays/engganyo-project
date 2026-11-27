"""Tiny plug-in registries so handler modules stay decoupled."""
from __future__ import annotations

from typing import Awaitable, Callable

# name -> async fn(update, ctx, args:str)
COMMANDS: dict[str, Callable[..., Awaitable]] = {}
# input kind -> async fn(update, ctx, pending_row, message) -> bool(handled)
INPUTS: dict[str, Callable[..., Awaitable]] = {}
# settings "act" name -> async fn(update, ctx, chat_id, query)
ACTIONS: dict[str, Callable[..., Awaitable]] = {}
# commands that only make sense in private chat / only in groups (for help text & routing)
PRIVATE_ONLY: set[str] = set()
HELP: dict[str, tuple[str, str]] = {}  # name -> (min role emoji, description)


def command(*names: str, private: bool = False, role: str = "👥", desc: str = ""):
    def deco(fn):
        for n in names:
            prev = COMMANDS.get(n.lower())
            if prev is not None and prev.__qualname__ != fn.__qualname__:
                raise RuntimeError(f"duplicate command /{n}: {prev.__module__}.{prev.__qualname__} vs {fn.__module__}.{fn.__qualname__}")
            COMMANDS[n.lower()] = fn
            if private:
                PRIVATE_ONLY.add(n.lower())
            HELP[n.lower()] = (role, desc)
        return fn
    return deco


def on_input(kind: str):
    def deco(fn):
        INPUTS[kind] = fn
        return fn
    return deco


def action(name: str):
    def deco(fn):
        ACTIONS[name] = fn
        return fn
    return deco
