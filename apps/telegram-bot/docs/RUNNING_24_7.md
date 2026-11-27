# Running 24/7

```powershell
powershell -ExecutionPolicy Bypass -File .un_forever.ps1
```
`run_forever.ps1` starts the bot and starts it again 5 seconds after any stop or crash; output goes to `logsot.log`.
To start it with Windows, create a Task Scheduler task (trigger: *At log on*, action: the command above).
The bot keeps its data in `data\guardbot.db` (SQLite, WAL) so a restart loses nothing.
