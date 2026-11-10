# Pubblica una nuova versione di BTV:
#   powershell -ExecutionPolicy Bypass -File .\tools\publish-release.ps1
# Non chiede password: le due chiavi restano solo su questo PC (%USERPROFILE%\.btv), protette da una password
# casuale cifrata con il tuo account Windows. Copia di sicurezza: tools\backup-keys.ps1
#  1. Fire TV / Android: compila l'APK firmato e lo carica come "release" su GitHub (btv-player/btv)
#  2. LG / Samsung: crea il pacchetto del codice e lo firma con la chiave Ed25519 (www\web\btv-<versione>.json)
#  3. solo alla fine pubblica www\version.json: le app vedono "È disponibile un aggiornamento" e, se premi OK,
#     installano verificando impronta (APK) o firma (TV). Senza le chiavi nessuno può pubblicare aggiornamenti validi.
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$gh = "C:\Program Files\GitHub CLI\gh.exe"
$repo = 'btv-player/btv'

function Read-Secret([string]$prompt) {
  $s = Read-Host $prompt -AsSecureString
  $b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) }
}

Push-Location $root
try {
  $ver = ([regex]::Match((Get-Content www\js\app.js -Raw), "APP_VERSION = '(\d+\.\d+\.\d+)'")).Groups[1].Value
  if (-not $ver) { throw "APP_VERSION non trovata in www\js\app.js" }
  $tag = "v$ver"
  cmd /c "`"$gh`" release view $tag --repo $repo >nul 2>&1"   # via cmd: in PowerShell 5.1 stderr redirezionato = errore
  if ($LASTEXITCODE -eq 0) { throw "La versione $ver e' gia' pubblicata: aumenta APP_VERSION in www\js\app.js" }
  if (git status --porcelain) { throw "Ci sono modifiche non salvate in git: prima salvale (commit) e pubblicale" }

  # Password delle chiavi: casuale, generata qui, salvata cifrata con il TUO account Windows (DPAPI).
  # Solo questo utente su questo PC la puo' leggere; per un altro PC usa tools\backup-keys.ps1.
  $keyDir = Join-Path $env:USERPROFILE ".btv"
  $pwFile = Join-Path $keyDir "key-password.dpapi"
  $first = -not (Test-Path (Join-Path $keyDir "btv-release.p12"))
  if (Test-Path $pwFile) {
    $sec = (Get-Content $pwFile -Raw).Trim() | ConvertTo-SecureString
    $b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
    try { $pw = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) }
  } else {
    if ($first) {
      $bytes = New-Object byte[] 32
      $rng = [Security.Cryptography.RandomNumberGenerator]::Create(); $rng.GetBytes($bytes); $rng.Dispose()
      $pw = [Convert]::ToBase64String($bytes)
      Write-Host "Prima pubblicazione: creo le chiavi con una password casuale protetta dal tuo account Windows." -ForegroundColor Cyan
    } else {
      # Chiavi gia' create con una password scelta a mano: chiesta un'ultima volta, poi salvata protetta
      $pw = Read-Secret "Password delle chiavi di firma (ultima volta)"
    }
    New-Item -ItemType Directory -Force $keyDir | Out-Null
    $sec = ConvertTo-SecureString $pw -AsPlainText -Force
    [IO.File]::WriteAllText($pwFile, (ConvertFrom-SecureString $sec))
  }
  if ($pw.Length -lt 8) { throw "Password delle chiavi non valida" }
  $env:BTV_KEY_PASSWORD = $pw
  $pw = $null; $sec = $null

  # Chiave per le TV: la prima volta si crea e la sua parte pubblica entra nell'app (www\js\boot.js)
  node tools/sign-web.js init
  if ($LASTEXITCODE -ne 0) { throw "Chiave di firma per le TV non disponibile" }
  if (git status --porcelain www/js/boot.js) {
    git add www/js/boot.js
    git commit -q -m "Chiave pubblica per gli aggiornamenti firmati delle TV"
    Write-Host "IMPORTANTE: reinstalla BTV sulla LG una volta (tools\install-lg.ps1): da li' in poi si aggiorna dalla TV." -ForegroundColor Yellow
  }

  Write-Host "Compilo BTV $ver firmato per Fire TV / Android..." -ForegroundColor Cyan
  & powershell -ExecutionPolicy Bypass -File tools\build-apk.ps1
  if ($LASTEXITCODE -ne 0) { throw "Compilazione non riuscita" }
  $sha = (Get-FileHash dist\BTV.apk -Algorithm SHA256).Hash.ToLower()

  Write-Host "Firmo l'aggiornamento per LG / Samsung..." -ForegroundColor Cyan
  $web = node tools/sign-web.js publish | ConvertFrom-Json
  if ($LASTEXITCODE -ne 0 -or -not $web.sig) { throw "Firma dell'aggiornamento TV non riuscita" }

  Write-Host "Carico la release $tag su GitHub..." -ForegroundColor Cyan
  & $gh release create $tag dist\BTV.apk --repo $repo --title "BTV $ver" --notes "BTV $ver per Fire TV / Android TV. SHA-256 dell'APK: $sha"
  if ($LASTEXITCODE -ne 0) { throw "Creazione della release non riuscita" }

  $json = [ordered]@{
    version = $ver
    apk = [ordered]@{ url = "https://github.com/$repo/releases/download/$tag/BTV.apk"; sha256 = $sha }
    web = [ordered]@{ url = $web.url; sig = $web.sig }
  } | ConvertTo-Json
  [IO.File]::WriteAllText((Join-Path $root 'www\version.json'), $json + "`n")
  git add www/version.json updates/web
  git commit -q -m "Versione $ver pubblicata"
  git push -q
  Write-Host ""
  Write-Host "Fatto: BTV $ver pubblicata. Le app la segnaleranno al prossimo ritorno nella Home." -ForegroundColor Green
  Write-Host "Link diretto all'APK: https://github.com/$repo/releases/download/$tag/BTV.apk" -ForegroundColor Green
} finally {
  Remove-Item Env:BTV_KEY_PASSWORD -ErrorAction SilentlyContinue
  Pop-Location
}
