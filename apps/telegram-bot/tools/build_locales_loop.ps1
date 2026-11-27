# Keep running tools\build_locales.py until every language is built (the free translation service blocks bursts;
# the script resumes from data\translation_cache.json, so every round only does what is missing).
Set-Location (Split-Path $PSScriptRoot -Parent)
for ($i = 0; $i -lt 60; $i++) {
    $log = & .\.venv\Scripts\python.exe tools\build_locales.py
    $log | Select-Object -Last 6
    if (($log | Select-Object -Last 1) -notmatch 'not finished') { Write-Host "ALL LANGUAGES BUILT"; break }
    Write-Host "waiting 10 minutes before the next round ($i)"
    Start-Sleep -Seconds 900
}
