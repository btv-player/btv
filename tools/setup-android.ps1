# Prepara l'Android SDK per compilare BTV (da eseguire UNA volta).
#   powershell -ExecutionPolicy Bypass -File .\tools\setup-android.ps1
# Scarica gli strumenti ufficiali di Google, ti chiede di accettare le licenze (rispondi "y")
# e installa i componenti necessari: platform-tools (adb), Android 15 (API 35), build-tools 35.
$ErrorActionPreference = 'Stop'

$jdk = Get-ChildItem "C:\Program Files\Microsoft" -Directory -Filter "jdk-21*" -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $jdk) { Write-Host "Java 21 non trovato. Installalo con:  winget install Microsoft.OpenJDK.21" -ForegroundColor Red; exit 1 }
$env:JAVA_HOME = $jdk.FullName
$env:Path = "$($jdk.FullName)\bin;$env:Path"

$sdk = "$env:LOCALAPPDATA\Android\Sdk"
$sdkmanager = "$sdk\cmdline-tools\latest\bin\sdkmanager.bat"

if (-not (Test-Path $sdkmanager)) {
  Write-Host "Scarico gli Android command-line tools da Google (~150 MB)..." -ForegroundColor Cyan
  $dl = Join-Path $env:TEMP "btv-sdk-dl"
  New-Item -ItemType Directory -Force $dl, "$sdk\cmdline-tools" | Out-Null
  $zip = Join-Path $dl "cmdline-tools.zip"
  Invoke-WebRequest -UseBasicParsing "https://dl.google.com/android/repository/commandlinetools-win-16111833_latest.zip" -OutFile $zip
  Expand-Archive $zip -DestinationPath (Join-Path $dl "x") -Force
  Move-Item (Join-Path $dl "x\cmdline-tools") "$sdk\cmdline-tools\latest"
  Remove-Item -Recurse -Force $dl
}

$androidCli = "$sdk\cmdline-tools\latest\bin\android.exe"
Write-Host "Installo platform-tools, Android 15 (API 35) e build-tools 35..." -ForegroundColor Cyan
if (Test-Path $androidCli) {
  # Nuovo "Android CLI" di Google (2026): sintassi con "/" e licenze accettate durante l'installazione.
  & $androidCli "--sdk=$sdk" sdk install platform-tools platforms/android-36 build-tools/36.0.0
} else {
  Write-Host "Licenze dell'Android SDK di Google: leggile e rispondi 'y' per accettarle." -ForegroundColor Yellow
  & $sdkmanager "--sdk_root=$sdk" --licenses
  & $sdkmanager "--sdk_root=$sdk" "platform-tools" "platforms;android-36" "build-tools;36.0.0"
}
if (-not (Test-Path "$sdk\platforms\android-36") -or -not (Test-Path "$sdk\build-tools\36.0.0")) {
  Write-Host "Installazione dei componenti non riuscita: controlla i messaggi sopra." -ForegroundColor Red; exit 1
}

# Dice a Gradle dove si trova l'SDK.
$props = Join-Path $PSScriptRoot "..\android\local.properties"
"sdk.dir=" + ($sdk -replace '\\', '\\' -replace ':', '\:') | Set-Content -Encoding ASCII $props

Write-Host ""
Write-Host "Fatto! Ora compila l'APK con:  powershell -ExecutionPolicy Bypass -File .\tools\build-apk.ps1" -ForegroundColor Green
