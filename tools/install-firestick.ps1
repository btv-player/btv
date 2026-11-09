# Installa (o aggiorna) BTV sulla Fire TV Stick tramite la rete Wi-Fi.
#   powershell -ExecutionPolicy Bypass -File .\tools\install-firestick.ps1 192.168.1.50
# Prima, sulla Fire TV: Impostazioni > La mia Fire TV > Opzioni sviluppatore > Debug ADB = ON.
# Al primo collegamento la TV chiede "Consentire il debug USB?": scegli "Consenti" (e "Consenti sempre da questo computer").
param([Parameter(Mandatory = $true)][string]$Ip)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$adb = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
$apk = Join-Path $root "dist\BTV.apk"
if (-not (Test-Path $adb)) { Write-Host "adb non trovato: esegui prima tools\setup-android.ps1" -ForegroundColor Red; exit 1 }
if (-not (Test-Path $apk)) { Write-Host "APK non trovato: esegui prima tools\build-apk.ps1" -ForegroundColor Red; exit 1 }
if ($Ip -notmatch ':') { $Ip = "${Ip}:5555" }

Write-Host "Mi collego alla Fire TV ($Ip)... se sulla TV compare una richiesta, scegli CONSENTI." -ForegroundColor Cyan
& $adb connect $Ip
Start-Sleep -Seconds 2
$state = (& $adb -s $Ip get-state 2>&1) -join ' '
if ($state -match 'unauthorized') {
  Write-Host "Conferma la richiesta sulla TV (Consenti), poi rilancia questo comando." -ForegroundColor Yellow; exit 1
}
if ($state -notmatch 'device') {
  Write-Host "Fire TV non raggiungibile ($state). Controlla l'IP, che sia sulla stessa rete e che 'Debug ADB' sia attivo." -ForegroundColor Red; exit 1
}

Write-Host "Installo BTV (preferiti e impostazioni restano)..." -ForegroundColor Cyan
$out = (& $adb -s $Ip install -r $apk 2>&1) -join ' '
Write-Host $out
if ($out -match 'UPDATE_INCOMPATIBLE|signatures do not match') {
  Write-Host "Sulla TV c'e' una versione firmata con un'altra chiave (es. quella di prova)." -ForegroundColor Yellow
  Write-Host "Disinstallala dalla TV (preferiti e impostazioni andranno persi) e rilancia questo comando:" -ForegroundColor Yellow
  Write-Host "  $adb -s $Ip uninstall app.btv.player" -ForegroundColor Yellow
  exit 1
}
if ($out -notmatch 'Success') { Write-Host "Installazione non riuscita." -ForegroundColor Red; exit 1 }

Write-Host "Avvio l'app..." -ForegroundColor Cyan
& $adb -s $Ip shell monkey -p app.btv.player -c android.intent.category.LEANBACK_LAUNCHER 1 | Out-Null
Write-Host "Fatto! BTV è installata: la trovi anche in 'App' sulla Fire TV." -ForegroundColor Green
Write-Host "Sicurezza: quando hai finito, rimetti 'Debug ADB' su OFF nelle Opzioni sviluppatore della Fire TV." -ForegroundColor Yellow
