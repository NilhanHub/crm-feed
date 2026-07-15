# Dev Seed/Reset Script — LOCAL DEVELOPMENT ONLY
#
# This script clears all local dev data (db, uploads, exports, extraction_attempts,
# raw_responses) and optionally seeds test data for development testing. It must
# be explicitly invoked. It does NOT run automatically in production or on app start.
#
# Usage:
#   pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/dev-seed-reset.ps1 [-Seed]
#
# Without -Seed: clears all data (reset).
# With -Seed: clears all data, then seeds test data that exercises Round 2 + Round 3
# extraction endpoints (extraction_attempts, raw_responses, and the extraction pipeline).

param(
  [switch]$Seed
)

$ErrorActionPreference = "Stop"
$root = "C:\Users\Nilhan.dev\ZCodeProject\CRM_Feed"

Write-Host "=== CRM Feed Dev Data Reset ==="
Write-Host "This will DELETE all data in data/db, data/uploads, data/exports,"
Write-Host "  extraction_attempts, and raw_responses."
Write-Host "Press Ctrl+C within 3 seconds to cancel..."
Start-Sleep -Seconds 3

# Clear data
Get-ChildItem -Path "$root\data\db" -File | Where-Object { $_.Name -ne ".gitkeep" } | Remove-Item -Force
Get-ChildItem -Path "$root\data\exports" -File | Where-Object { $_.Name -ne ".gitkeep" } | Remove-Item -Force
Get-ChildItem -Path "$root\data\uploads" -File | Where-Object { $_.Name -ne ".gitkeep" } | Remove-Item -Force
Write-Host "Cleared: data/db (including extraction_attempts, raw_responses), data/uploads, data/exports"

if (-not $Seed) {
  Write-Host "Done (reset only). Use -Seed to also seed test data."
  exit 0
}

Write-Host ""
Write-Host "=== Seeding test data ==="

# Start API temporarily
$apiDir = Join-Path $root "apps\api"
$api = Start-Process -FilePath "node" -ArgumentList "dist/index.js" -WorkingDirectory $apiDir -PassThru -WindowStyle Hidden -RedirectStandardOutput "$root\Evidence\dev_seed_api_out.txt" -RedirectStandardError "$root\Evidence\dev_seed_api_err.txt"

try {
  # Wait for health
  $ok = $false
  for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Milliseconds 250
    try { $h = Invoke-RestMethod -Uri "http://localhost:8787/api/health" -TimeoutSec 2; if ($h.status -eq "ok") { $ok = $true; break } } catch { }
  }
  if (-not $ok) { throw "API did not start" }

  $headers = @{ "Content-Type" = "application/json" }

  # Create company
  $co = Invoke-RestMethod -Uri "http://localhost:8787/api/companies" -Method Post -Headers $headers -Body (@{ name = "Test Corp" } | ConvertTo-Json)
  Write-Host "Created company: $($co.name) ($($co.id))"

  # Create batch
  $bat = Invoke-RestMethod -Uri "http://localhost:8787/api/batches" -Method Post -Headers $headers -Body (@{ companyId = $co.id; label = "Test batch" } | ConvertTo-Json)
  Write-Host "Created batch: $($bat.id)"

  # Upload a test PNG
  $pngB64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
  $pngPath = Join-Path $env:TEMP "crmfeed_seed.png"
  [IO.File]::WriteAllBytes($pngPath, [Convert]::FromBase64String($pngB64))
  $upRaw = & curl.exe -s -X POST -F "screenshots=@$pngPath;type=image/png" "http://localhost:8787/api/batches/$($bat.id)/screenshots"
  $up = $upRaw | ConvertFrom-Json
  Write-Host "Uploaded $($up.screenshots.Count) screenshot(s)"

  # --- Round 3: Exercise extraction endpoint ---
  # POST /api/extraction/extract/:screenshotId creates an extraction_attempt and
  # runs the Gemini extraction pipeline. Without configured credentials, it will
  # fail with missing_credentials — this is expected and exercises the Round 3
  # extraction attempt recording + raw response storage paths.
  Write-Host ""
  Write-Host "--- Round 3: Exercise extraction endpoints ---"
  $extractResult = $null
  try {
    $extractResult = Invoke-RestMethod -Uri "http://localhost:8787/api/extraction/extract/$($up.screenshots[0].id)" -Method Post -Headers $headers -TimeoutSec 10
    Write-Host "Extract result: $($extractResult.status)"
  } catch {
    $errBody = $_.Exception.Response
    if ($errBody) {
      $reader = New-Object System.IO.StreamReader($errBody.GetResponseStream())
      $errText = $reader.ReadToEnd()
      Write-Host "Extract endpoint response: $errText"
    } else {
      Write-Host "Extract endpoint: $($_.Exception.Message)"
    }
  }

  # --- Round 2: Existing manual attach payload ---
  Write-Host ""
  Write-Host "--- Round 2: Attach manual extraction payload ---"

  # Create extraction run for manual attach
  $run = Invoke-RestMethod -Uri "http://localhost:8787/api/extraction-runs" -Method Post -Headers $headers -Body (@{ batchId = $bat.id; provider = "manual_attach" } | ConvertTo-Json)
  Write-Host "Created extraction run: $($run.id) (status: $($run.status))"

  # Attach test payload
  $payload = @{
    targetCompanyName = "Test Corp"
    screenshots = @(@{ screenshotId = $up.screenshots[0].id })
    extractionMeta = @{ provider = "manual_attach"; overallConfidence = 1 }
    people = @(
      @{ personId = "test1"; name = "Test Person One"; title = "CTO"; location = "London";
         currentRoles = @(@{ title = "CTO"; company = "Test Corp" });
         pastRoles = @();
         mutualContacts = @{ named = @(@{ name = "Mutual One" }); vagueCount = $null };
         sourceScreenshotIds = @($up.screenshots[0].id); confidence = 1 }
    )
  }
  $attach = Invoke-RestMethod -Uri "http://localhost:8787/api/extraction-runs/$($run.id)/payload" -Method Post -Headers $headers -Body (@{ payload = $payload } | ConvertTo-Json -Depth 20)
  Write-Host "Attached payload: $($attach.people.Count) person(s)"

  # --- Verify extraction_attempt was recorded ---
  try {
    $attempts = Invoke-RestMethod -Uri "http://localhost:8787/api/extraction/attempts/screenshot/$($up.screenshots[0].id)" -Method Get -Headers $headers
    $attemptCount = $attempts.attempts.Count
    Write-Host "Extraction attempts recorded for screenshot: $attemptCount"
  } catch {
    Write-Host "Could not verify extraction attempts (endpoint may not exist yet)"
  }

  Write-Host ""
  Write-Host "Seed complete. Test data is now available for development."
  Write-Host "Data includes:"
  Write-Host "  - Extraction attempts (Round 3 pipeline exercise)"
  Write-Host "  - Attached people (Round 2 manual attach)"
  Write-Host "NOTE: This is TEST data only. Do not treat as real contacts."
} finally {
  try { $api.Kill() } catch { }
}
