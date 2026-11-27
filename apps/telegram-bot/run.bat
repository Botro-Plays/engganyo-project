@echo off
cd /d "%~dp0"
if not exist .venv (python -m venv .venv && .venv\Scripts\python -m pip install -r requirements.txt)
if not exist .env (copy .env.example .env && echo Created .env - open it, set BOT_TOKEN and OWNER_IDS, then run again. && notepad .env && exit /b)
.venv\Scripts\python main.py
pause
