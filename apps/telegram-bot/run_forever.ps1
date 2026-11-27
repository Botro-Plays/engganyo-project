# Keeps Engganyo running 24/7: if the bot ever stops or crashes it is started again after 5 seconds.
# Start it with:   powershell -ExecutionPolicy Bypass -File .\run_forever.ps1
# Stop it with:    Ctrl+C          Logs: logs\bot.log (UTF-8)
Set-Location -Path $PSScriptRoot
New-Item -ItemType Directory -Force -Path "logs" | Out-Null
$python = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"
$log = Join-Path $PSScriptRoot "logs\bot.log"
while ($true) {
    $stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Add-Content -Path $log -Value "[$stamp] starting bot" -Encoding utf8
    & $python main.py 2>&1 | ForEach-Object { Add-Content -Path $log -Value "$_" -Encoding utf8; "$_" }
    $stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Add-Content -Path $log -Value "[$stamp] bot stopped (exit code $LASTEXITCODE) - restarting in 5 s" -Encoding utf8
    Start-Sleep -Seconds 5
}
