# Genera icone, banner e schermata di avvio di BTV dal logo sorgente (assets\logo-source.jpg).
#   powershell -ExecutionPolicy Bypass -File .\tools\make-icons.ps1
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$root = Split-Path $PSScriptRoot -Parent
$assets = Join-Path $root 'assets'
$src = [System.Drawing.Image]::FromFile((Join-Path $assets 'logo-source.jpg'))

# Ritaglio quadrato interno: toglie gli angoli arrotondati (neri nel JPG) e lascia solo lo sfondo blu notte.
$s = [int]($src.Width * 0.80)
$crop = New-Object System.Drawing.Rectangle ([int]($src.Width * 0.112)), ([int]($src.Height * 0.068)), $s, $s
$bg = [System.Drawing.Color]::FromArgb(255, 3, 8, 26)

function Save-Png($w, $h, $logoSize, $file) {
  $bmp = New-Object System.Drawing.Bitmap $w, $h
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.Clear($bg)
  $dst = New-Object System.Drawing.Rectangle ([int](($w - $logoSize) / 2)), ([int](($h - $logoSize) / 2)), $logoSize, $logoSize
  $g.DrawImage($src, $dst, $crop, [System.Drawing.GraphicsUnit]::Pixel)
  $g.Dispose()
  $bmp.Save((Join-Path $assets $file), [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
}

Save-Png 512 512 512 'icon-512.png'
Save-Png 192 192 192 'icon-192.png'
Save-Png 130 130 130 'icon-130.png'
Save-Png 80 80 80 'icon-80.png'
Save-Png 320 180 176 'banner-320x180.png'
Save-Png 1920 1080 620 'splash-1920x1080.png'
$src.Dispose()
Copy-Item (Join-Path $assets 'icon-192.png') (Join-Path $root 'www\icon.png') -Force
Write-Host "Icone generate in assets\ e www\icon.png" -ForegroundColor Green
