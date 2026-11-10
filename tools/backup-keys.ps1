# Copia di sicurezza delle chiavi di firma di BTV (per un nuovo PC o se Windows si reinstalla).
#   powershell -ExecutionPolicy Bypass -File .\tools\backup-keys.ps1 -Dest E:\btv-backup
# Copia le chiavi (cifrate) nella cartella indicata, es. una chiavetta USB, e mostra UNA volta la password
# che le apre: scrivila in un gestore di password. Senza chiavi + password non potrai piu' pubblicare
# aggiornamenti per le app gia' installate.
# Ripristino su un altro PC: copia i due file in %USERPROFILE%\.btv, poi lancia questo script con -Restore.
param([string]$Dest, [switch]$Restore)
$ErrorActionPreference = 'Stop'
$keyDir = Join-Path $env:USERPROFILE ".btv"
$pwFile = Join-Path $keyDir "key-password.dpapi"
$files = @("btv-release.p12", "web-signing-key.pem")

if ($Restore) {
  foreach ($f in $files) { if (-not (Test-Path (Join-Path $keyDir $f))) { throw "Manca $keyDir\$f" } }
  $s = Read-Host "Password delle chiavi (dalla copia di sicurezza)" -AsSecureString
  [IO.File]::WriteAllText($pwFile, (ConvertFrom-SecureString $s))
  Write-Host "Fatto: la pubblicazione su questo PC non chiedera' piu' la password." -ForegroundColor Green
  exit 0
}

if (-not $Dest) { throw "Indica la cartella: -Dest E:\btv-backup" }
if (-not (Test-Path $pwFile)) { throw "Nessuna chiave da salvare: pubblica prima una versione" }
New-Item -ItemType Directory -Force $Dest | Out-Null
foreach ($f in $files) { Copy-Item (Join-Path $keyDir $f) (Join-Path $Dest $f) -Force }
$sec = (Get-Content $pwFile -Raw).Trim() | ConvertTo-SecureString
$b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
try { $pw = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) }
Write-Host "Chiavi copiate in $Dest" -ForegroundColor Green
Write-Host "Password (salvala in un gestore di password, NON nella stessa chiavetta):" -ForegroundColor Yellow
Write-Host "  $pw"
$pw = $null
