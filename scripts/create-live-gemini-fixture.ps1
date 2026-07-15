param(
  [string]$OutputPath = "data\fixtures\live_gemini_fixture.png"
)

# Ensure parent directory exists
$parent = Split-Path -Parent $OutputPath
if (-not (Test-Path -LiteralPath $parent)) {
  New-Item -ItemType Directory -Path $parent -Force | Out-Null
}

Add-Type -AssemblyName System.Drawing

$bmp = New-Object System.Drawing.Bitmap(800, 500)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.Clear([System.Drawing.Color]::White)

$fontTitle = New-Object System.Drawing.Font("Arial", 18, [System.Drawing.FontStyle]::Bold)
$fontBody  = New-Object System.Drawing.Font("Arial", 14, [System.Drawing.FontStyle]::Regular)
$fontLabel = New-Object System.Drawing.Font("Arial", 12, [System.Drawing.FontStyle]::Italic)
$brushBlack = [System.Drawing.Brushes]::Black
$brushGray  = [System.Drawing.Brushes]::Gray
$brushRed   = [System.Drawing.Brushes]::Red

$g.DrawString("CRM Feed Gemini Live Test Fixture", $fontTitle, $brushBlack, 30, 20)
$g.DrawString("(TEST FIXTURE ONLY — NOT REAL DATA)", $fontLabel, $brushRed, 30, 55)

$g.DrawString("Company: Acme Test Company", $fontBody, $brushBlack, 30, 100)
$g.DrawString("Person: Alex Morgan", $fontBody, $brushBlack, 30, 140)
$g.DrawString("Headline: Chief Technology Officer", $fontBody, $brushBlack, 30, 180)
$g.DrawString("Current role: CTO at Acme Test Company", $fontBody, $brushBlack, 30, 220)
$g.DrawString("Location: London, United Kingdom", $fontBody, $brushBlack, 30, 260)
$g.DrawString("Connection: 2nd", $fontBody, $brushBlack, 30, 300)
$g.DrawString("Mutual contact: Paul Smith", $fontBody, $brushBlack, 30, 340)
$g.DrawString("Mutual contact: Sarah Jones", $fontBody, $brushBlack, 30, 380)

$g.DrawString("Generated: $((Get-Date).ToString('yyyy-MM-dd HH:mm:ss'))", $fontLabel, $brushGray, 30, 440)
$g.DrawString("Fixture for live Gemini extraction verification", $fontLabel, $brushGray, 30, 465)

$fullPath = [System.IO.Path]::GetFullPath([System.IO.Path]::Combine($PSScriptRoot, "..", $OutputPath))
$bmp.Save($fullPath, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose()
$bmp.Dispose()

Write-Host "Fixture image created: $fullPath"
Write-Host "Size: $((Get-Item $fullPath).Length) bytes"
