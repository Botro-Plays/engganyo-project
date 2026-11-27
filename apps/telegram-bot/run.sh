#!/usr/bin/env bash
cd "$(dirname "$0")"
[ -d .venv ] || { python3 -m venv .venv && .venv/bin/pip install -r requirements.txt; }
[ -f .env ] || { cp .env.example .env; echo "Created .env – set BOT_TOKEN and OWNER_IDS, then run again."; exit 1; }
exec .venv/bin/python main.py
