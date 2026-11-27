"""Hide the drop-down command list of the main bot: python tools/publish_commands.py"""
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from telegram import Bot

from guardbot import config
from guardbot.handlers.clones import clear_command_list


async def main():
    async with Bot(config.BOT_TOKEN) as b:
        await clear_command_list(b)
        print("command list cleared")


asyncio.run(main())
