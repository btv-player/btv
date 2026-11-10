# Compila l'APK di BTV per Fire TV / Android TV.
#   powershell -ExecutionPolicy Bypass -File .\tools\build-apk.ps1          (definitivo, firmato con la tua chiave)
#   powershell -ExecutionPolicy Bypass -File .\tools\build-apk.ps1 -Debug   (di prova: dati dell'app leggibili via ADB)
# Risultato: dist\BTV.apk
#
# La chiave di firma sta FUORI dal progetto: %USERPROFILE%\.btv\btv-release.p12
# Fanne una copia (chiavetta USB o cloud privato): senza la stessa chiave non potrai piu' aggiornare l'app
# installata, solo disinstallarla e reinstallarla (perdendo preferiti e impostazioni).
# Con publish-release.ps1 la password e' casuale e protetta dal tuo account Windows (DPAPI); da solo la chiede.
param([switch]$Debug)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent

$jdk = Get-ChildItem "C:\Program Files\Microsoft" -Directory -Filter "jdk-21*" -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $jdk) { Write-Host "Java 21 non trovato: esegui prima tools\setup-android.ps1" -ForegroundColor Red; exit 1 }
$env:JAVA_HOME = $jdk.FullName
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
$env:Path = "$($jdk.FullName)\bin;$env:ANDROID_HOME\platform-tools;$env:Path"
if (-not (Test-Path "$env:ANDROID_HOME\platforms\android-36")) { Write-Host "Android SDK mancante: esegui prima tools\setup-android.ps1" -ForegroundColor Red; exit 1 }

function Read-Secret([string]$prompt) {
  $s = Read-Host $prompt -AsSecureString
  $b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) }
}

$keyDir = Join-Path $env:USERPROFILE ".btv"
$keyFile = Join-Path $keyDir "btv-release.p12"

Push-Location $root
try {
  if (-not $Debug) {
    if (-not (Test-Path $keyFile)) {
      Write-Host "Prima volta: creo la tua chiave di firma personale ($keyFile)." -ForegroundColor Cyan
      Write-Host "Scegli una password di almeno 8 caratteri e conservala: servira' per ogni aggiornamento." -ForegroundColor Cyan
      if ($env:BTV_KEY_PASSWORD) { $pw = $env:BTV_KEY_PASSWORD; $pw2 = $pw }   # già chiesta da publish-release.ps1
      else { $pw = Read-Secret "Nuova password della chiave"; $pw2 = Read-Secret "Ripeti la password" }
      if ($pw -ne $pw2) { throw "Le password non coincidono" }
      if ($pw.Length -lt 8) { throw "Password troppo corta (minimo 8 caratteri)" }
      New-Item -ItemType Directory -Force $keyDir | Out-Null
      $env:BTV_PW = $pw
      & keytool -genkeypair -storetype PKCS12 -keystore $keyFile -alias btv -keyalg RSA -keysize 3072 -validity 10000 `
        -dname "CN=BTV" -storepass:env BTV_PW -keypass:env BTV_PW
      if ($LASTEXITCODE -ne 0) { throw "Creazione della chiave non riuscita" }
      Write-Host "Chiave creata. FANNE UNA COPIA DI SICUREZZA adesso: $keyFile" -ForegroundColor Yellow
    } elseif ($env:BTV_KEY_PASSWORD) {
      $pw = $env:BTV_KEY_PASSWORD                                            # già chiesta da publish-release.ps1
    } else {
      $pw = Read-Secret "Password della chiave di firma"
    }
    # Gradle legge le variabili ORG_GRADLE_PROJECT_* come proprieta': esistono solo per questo processo.
    $env:ORG_GRADLE_PROJECT_BTV_STORE_FILE = $keyFile
    $env:ORG_GRADLE_PROJECT_BTV_STORE_PASSWORD = $pw
    $pw = $null; $pw2 = $null
  }

  Write-Host "Copio l'app web nel progetto Android..." -ForegroundColor Cyan
  npx cap sync android
  if ($LASTEXITCODE -ne 0) { throw "cap sync non riuscito" }
  node tools/patch-android.js
  if ($LASTEXITCODE -ne 0) { throw "patch-android non riuscito" }

  Write-Host "Compilo l'APK (la prima volta Gradle scarica ~300 MB e ci mette qualche minuto)..." -ForegroundColor Cyan
  Push-Location android
  if ($Debug) { .\gradlew.bat assembleDebug --no-daemon } else { .\gradlew.bat assembleRelease --no-daemon }
  $code = $LASTEXITCODE
  Pop-Location
  if ($code -ne 0) { throw "Compilazione non riuscita (codice $code). Se e' la firma: password sbagliata?" }

  New-Item -ItemType Directory -Force dist | Out-Null
  $out = if ($Debug) { "android\app\build\outputs\apk\debug\app-debug.apk" } else { "android\app\build\outputs\apk\release\app-release.apk" }
  Copy-Item $out dist\BTV.apk -Force
  (Get-FileHash dist\BTV.apk -Algorithm SHA256).Hash.ToLower() | Set-Content -Encoding ascii dist\BTV.apk.sha256
  $mb = [math]::Round((Get-Item dist\BTV.apk).Length / 1MB, 1)
  $kind = if ($Debug) { "di prova" } else { "definitivo firmato" }
  Write-Host ""
  Write-Host "APK pronto: dist\BTV.apk ($mb MB, $kind)" -ForegroundColor Green
} finally {
  Remove-Item Env:BTV_PW, Env:ORG_GRADLE_PROJECT_BTV_STORE_PASSWORD, Env:ORG_GRADLE_PROJECT_BTV_STORE_FILE -ErrorAction SilentlyContinue
  Pop-Location
}
