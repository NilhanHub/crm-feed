param(
  [string]$ApiUrl = "http://localhost:8787"
)

$ErrorActionPreference = "Stop"
$pass = 0
$fail = 0

function Test-Step {
  param($Name, $ScriptBlock)
  try {
    & $ScriptBlock
    Write-Host "  PASS: $Name" -ForegroundColor Green
    $script:pass++
  } catch {
    Write-Host "  FAIL: $Name -- $($_.Exception.Message)" -ForegroundColor Red
    $script:fail++
  }
}

Write-Host "=== Refresh Bug Regression Test ===" -ForegroundColor Cyan
Write-Host "API: $ApiUrl`n"

# 1. Create test company
Test-Step "Create company" {
  $body = '{"name":"Refresh Test Company","notes":"Regression test"}'
  $company = Invoke-RestMethod -Uri "$ApiUrl/api/companies" -Method Post -ContentType "application/json" -Body $body
  if (-not $company.id) { throw "No company id" }
  $script:companyId = $company.id
  Write-Host "    Company: $($company.id)"
}

# 2. Create batch
Test-Step "Create batch" {
  $body = "{`"companyId`":`"$companyId`",`"label`":`"Refresh test batch`"}"
  $batch = Invoke-RestMethod -Uri "$ApiUrl/api/batches" -Method Post -ContentType "application/json" -Body $body
  if (-not $batch.id) { throw "No batch id" }
  $script:batchId = $batch.id
  Write-Host "    Batch: $($batch.id)"
}

# 3. Verify batch is in company detail
Test-Step "Company detail includes batch" {
  $detail = Invoke-RestMethod -Uri "$ApiUrl/api/companies/$companyId" -Method Get
  $batches = $detail.batches | Where-Object { $_.id -eq $batchId }
  if (-not $batches) { throw "Batch not found in company detail" }
  Write-Host "    Batches in detail: $($detail.batches.Count)"
}

# 4. Upload a fixture image
Test-Step "Upload screenshots" {
  $fixturePath = "data\fixtures\live_gemini_fixture.png"
  $upload = curl.exe -s -X POST "$ApiUrl/api/batches/$batchId/screenshots" -F "screenshots=@$fixturePath;type=image/png" | ConvertFrom-Json
  if ($upload.screenshots.Count -eq 0) { throw "No screenshots returned" }
  $script:screenshotId = $upload.screenshots[0].id
  Write-Host "    Screenshot: $($script:screenshotId)"
}

# 5. Verify batch detail now includes screenshot
Test-Step "Batch detail includes screenshot after upload" {
  $batchDetail = Invoke-RestMethod -Uri "$ApiUrl/api/batches/$batchId" -Method Get
  if ($batchDetail.screenshots.Count -eq 0) { throw "No screenshots in batch detail after upload" }
  Write-Host "    Screenshots in batch: $($batchDetail.screenshots.Count)"
}

# 6. Create extraction run
Test-Step "Create extraction run" {
  $body = "{`"batchId`":`"$batchId`",`"provider`":`"none`"}"
  $run = Invoke-RestMethod -Uri "$ApiUrl/api/extraction-runs" -Method Post -ContentType "application/json" -Body $body
  if (-not $run.id) { throw "No run id" }
  $script:runId = $run.id
  Write-Host "    Run: $($run.id) status: $($run.status)"
}

# 7. Verify company detail includes the run
Test-Step "Company detail includes extraction run" {
  $detail = Invoke-RestMethod -Uri "$ApiUrl/api/companies/$companyId" -Method Get
  $runs = $detail.extractionRuns | Where-Object { $_.batchId -eq $batchId }
  if (-not $runs) { throw "Extraction run not found in company detail" }
  Write-Host "    Runs in detail: $($detail.extractionRuns.Count)"
}

# 8. Review queue exists
Test-Step "Review queue endpoint responds" {
  $queue = Invoke-RestMethod -Uri "$ApiUrl/api/reviews/company/$companyId" -Method Get
  if ($null -eq $queue) { throw "No queue response" }
  Write-Host "    Queue items: $($queue.items.Count)"
}

# 9. Status summary exists
Test-Step "Status summary responds" {
  $status = Invoke-RestMethod -Uri "$ApiUrl/api/status/company/$companyId" -Method Get
  if ($null -eq $status) { throw "No status response" }
  Write-Host "    Batches: $($status.counts.batches) Screenshots: $($status.counts.screenshotsUploaded)"
}

# 10. Audit events exist
Test-Step "Audit events exist" {
  $url = "$ApiUrl/api/audit?companyId=$companyId" + "&limit=25"
  $audit = Invoke-RestMethod -Uri $url -Method Get
  if ($audit.events.Count -eq 0) { throw "No audit events" }
  Write-Host "    Events: $($audit.events.Count)"
}

Write-Host "`n=== Results ===" -ForegroundColor Cyan
Write-Host "Passed: $pass  Failed: $fail" -ForegroundColor $(if ($fail -eq 0) { "Green" } else { "Red" })
if ($fail -eq 0) { Write-Host "REFRESH STATE VERIFICATION: PASS" -ForegroundColor Green }
else { Write-Host "REFRESH STATE VERIFICATION: FAIL" -ForegroundColor Red }
