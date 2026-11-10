# Legge dalla TV LG il codice della modalità sviluppatore e lo salva come segreto cifrato su GitHub
# (LG_DEVMODE_TOKEN), usato da .github/workflows/lg-devmode.yml per rinnovare la sessione ogni giorno.
#   powershell -ExecutionPolicy Bypass -File .\tools\lg-devmode-secret.ps1
# Va rilanciato solo se il rinnovo automatico fallisce (es. dopo aver reinstallato l'app Developer Mode).
# Il codice non viene mai mostrato.
$gh = "C:\Program Files\GitHub CLI\gh.exe"
$out = ares-novacom --device btvtv --run "cat /var/luna/preferences/devmode_enabled" 2>$null
$ErrorActionPreference = 'Stop'
$tok = (($out | Where-Object { $_ -notmatch '^\[Info\]' }) -join '').Trim()
if ($tok -notmatch '^[A-Za-z0-9]{32,128}$') { throw "Codice non letto dalla TV: la TV e' accesa e raggiungibile?" }
& $gh secret set LG_DEVMODE_TOKEN --repo btv-player/btv --body $tok
if ($LASTEXITCODE -ne 0) { throw "Salvataggio del segreto su GitHub non riuscito" }
$tok = $null
Write-Host "Fatto: codice salvato su GitHub. Torna nella chat e scrivi 'fatto'." -ForegroundColor Green
