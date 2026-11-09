# Installa (o aggiorna) BTV su una TV LG (webOS) tramite la rete Wi-Fi.
#   powershell -ExecutionPolicy Bypass -File .\tools\install-lg.ps1 192.168.1.60
# Prima, sulla TV: app "Developer Mode" (LG Content Store) > accedi con l'account sviluppatore LG >
# "Dev Mode Status" ON (la TV si riavvia) > riapri l'app > "Key Server" ON. L'IP e la passphrase sono scritti nell'app.
# La modalita' sviluppatore dura 50 ore: rinnovala con "Extend Session" nell'app Developer Mode.
param([Parameter(Mandatory = $true)][string]$Ip)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
Push-Location $root
try {
  if (-not (Get-Command ares-install -ErrorAction SilentlyContinue)) {
    Write-Host "Installo gli strumenti LG (webOS CLI)..." -ForegroundColor Cyan
    npm install -g @webos-tools/cli
    if ($LASTEXITCODE -ne 0) { throw "Installazione degli strumenti LG non riuscita" }
    $env:Path = "$env:APPDATA\npm;$env:Path"
  }

  Write-Host "Preparo il pacchetto per LG..." -ForegroundColor Cyan
  node tools/build-tv.js webos | Out-Null
  $ipkDir = Join-Path $root "dist\webos-ipk"
  Remove-Item $ipkDir -Recurse -Force -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Force $ipkDir | Out-Null
  ares-package dist\webos -o $ipkDir
  if ($LASTEXITCODE -ne 0) { throw "Creazione del pacchetto non riuscita" }
  $ipk = Get-ChildItem $ipkDir -Filter *.ipk | Select-Object -First 1

  # Aggiornamento: se la TV è già registrata con lo stesso IP e la chiave c'è, non serve rifare la passphrase.
  $keyFile = Join-Path $env:USERPROFILE ".ssh\btvtv_webos"
  $known = ((ares-setup-device --list) -join "`n") -match "btvtv\s+prisoner@$([regex]::Escape($Ip)):9922"
  if ($known -and (Test-Path $keyFile)) {
    Write-Host "TV gia' registrata: aggiorno l'app." -ForegroundColor Cyan
  } else {
    Write-Host "Registro la TV ($Ip)..." -ForegroundColor Cyan
    $ErrorActionPreference = 'Continue'
    ares-setup-device --remove btvtv 2>$null | Out-Null
    $ErrorActionPreference = 'Stop'
    ares-setup-device --add btvtv --info "host=$Ip" --info "port=9922" --info "username=prisoner"
    if ($LASTEXITCODE -ne 0) { throw "Registrazione della TV non riuscita" }

    Write-Host ""
    Write-Host "Ora scrivi la PASSPHRASE mostrata nell'app Developer Mode della TV (6 caratteri, maiuscole comprese)." -ForegroundColor Yellow
    ares-novacom --device btvtv --getkey
    if ($LASTEXITCODE -ne 0) { throw "Chiave non ottenuta: controlla che 'Key Server' sia ON e la passphrase corretta" }
  }

  Write-Host "Installo BTV sulla TV..." -ForegroundColor Cyan
  ares-install --device btvtv $ipk.FullName
  if ($LASTEXITCODE -ne 0) { throw "Installazione non riuscita" }
  ares-launch --device btvtv app.btv.player | Out-Null
  Write-Host ""
  Write-Host "Fatto! BTV e' installata sulla TV LG (la trovi nella barra delle app)." -ForegroundColor Green
  Write-Host "Ricorda: la modalita' sviluppatore scade dopo 50 ore; rinnovala dall'app Developer Mode (Extend Session)." -ForegroundColor Yellow
} finally {
  Pop-Location
}
