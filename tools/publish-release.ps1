# Pubblica una nuova versione di BTV (per Fire TV e per chi installa l'APK):
#   powershell -ExecutionPolicy Bypass -File .\tools\publish-release.ps1
# 1. compila l'APK firmato con la tua chiave (chiede la password)
# 2. lo carica come "release" su GitHub (btv-player/btv)
# 3. solo dopo pubblica www\version.json: le app vedono "Aggiornamento disponibile" e, se premi, installano
#    questo APK verificandone l'impronta SHA-256 (e Android verifica che sia firmato con la stessa chiave).
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$gh = "C:\Program Files\GitHub CLI\gh.exe"
$repo = 'btv-player/btv'
Push-Location $root
try {
  $ver = ([regex]::Match((Get-Content www\js\app.js -Raw), "APP_VERSION = '(\d+\.\d+\.\d+)'")).Groups[1].Value
  if (-not $ver) { throw "APP_VERSION non trovata in www\js\app.js" }
  $tag = "v$ver"
  & $gh release view $tag --repo $repo *> $null
  if ($LASTEXITCODE -eq 0) { throw "La versione $ver e' gia' pubblicata: aumenta APP_VERSION in www\js\app.js" }
  if (git status --porcelain) { throw "Ci sono modifiche non salvate in git: prima salvale (commit) e pubblicale" }

  Write-Host "Compilo BTV $ver firmato..." -ForegroundColor Cyan
  & powershell -ExecutionPolicy Bypass -File tools\build-apk.ps1
  if ($LASTEXITCODE -ne 0) { throw "Compilazione non riuscita" }
  $sha = (Get-FileHash dist\BTV.apk -Algorithm SHA256).Hash.ToLower()

  Write-Host "Carico la release $tag su GitHub..." -ForegroundColor Cyan
  & $gh release create $tag dist\BTV.apk --repo $repo --title "BTV $ver" --notes "BTV $ver per Fire TV / Android TV. SHA-256 dell'APK: $sha"
  if ($LASTEXITCODE -ne 0) { throw "Creazione della release non riuscita" }

  $json = [ordered]@{
    version = $ver
    apk = [ordered]@{ url = "https://github.com/$repo/releases/download/$tag/BTV.apk"; sha256 = $sha }
  } | ConvertTo-Json
  [IO.File]::WriteAllText((Join-Path $root 'www\version.json'), $json + "`n")
  git add www/version.json
  git commit -q -m "Versione $ver pubblicata"
  git push -q
  Write-Host ""
  Write-Host "Fatto: BTV $ver pubblicata. Le app la segnaleranno al prossimo ritorno nella home." -ForegroundColor Green
  Write-Host "Link diretto all'APK: https://github.com/$repo/releases/download/$tag/BTV.apk" -ForegroundColor Green
} finally {
  Pop-Location
}
