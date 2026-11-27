"""Register an existing channel (the bot must already be admin there): python tools/register_channel.py -100123... [owner_id]
Normally this happens by itself when the bot is added as admin or sees a post/join; this helps for channels added earlier."""
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from telegram import Bot

from guardbot import config, database


async def main(cid: int, owner: int):
    database.init()
    async with Bot(config.BOT_TOKEN) as b:
        chat = await b.get_chat(cid)
        me = await b.get_chat_member(cid, (await b.get_me()).id)
        print(chat.title, chat.type, me.status)
        if chat.type != "channel" or me.status != "administrator":
            raise SystemExit("not a channel where the bot is admin")
        d = database.get()
        d.ensure_chat(cid, chat.title or "", "channel", owner_id=owner)
        d.set_chat(cid, active=1, title=chat.title or "")
        print("registered")


asyncio.run(main(int(sys.argv[1]), int(sys.argv[2]) if len(sys.argv) > 2 else (sorted(config.OWNER_IDS) or [0])[0]))
