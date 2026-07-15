# Round 4 API smoke test — production readiness (backup, audit, export verification, health).
# Exercises: health diagnostics, company/batch creation, screenshot upload, missing-key
# Gemini failure, manual import, review approval, audit events, email, export, export
# verification, backup creation + verification, no-bypass-review, company scoping.
$ErrorActionPreference = "Stop"

$root = "C:\Users\Nilhan.dev\ZCodeProject\CRM_Feed"
$apiDir = Join-Path $root "apps\api"
$out = Join-Path $root "Evidence\round_4_smoke_output.txt"
"Round 4 API smoke test - $(Get-Date -Format o)" | Set-Content -LiteralPath $out
function L($s) { $s | Add-Content -LiteralPath $out; Write-Host $s }

# Clean dev data
Get-ChildItem -Path "$root\data\db" -File | Where-Object { $_.Name -ne ".gitkeep" } | Remove-Item -Force -ErrorAction SilentlyContinue
Get-ChildItem -Path "$root\data\exports" -File | Where-Object { $_.Name -ne ".gitkeep" } | Remove-Item -Force -ErrorAction SilentlyContinue
Get-ChildItem -Path "$root\data\uploads" -File | Where-Object { $_.Name -ne ".gitkeep" } | Remove-Item -Force -ErrorAction SilentlyContinue

# Start API (must build first: npm run build)
$api = Start-Process -FilePath "node" -ArgumentList "dist/index.js" -WorkingDirectory $apiDir `
  -PassThru -WindowStyle Hidden `
  -RedirectStandardOutput (Join-Path $root "Evidence\round_4_smoke_api_out.txt") `
  -RedirectStandardError (Join-Path $root "Evidence\round_4_smoke_api_err.txt")

try {
  $ok = $false
  for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Milliseconds 250
    try { $h = Invoke-RestMethod -Uri "http://localhost:8787/api/health" -TimeoutSec 2; if ($h.status -eq "ok") { $ok = $true; break } } catch { }
  }
  if (-not $ok) { throw "API did not become healthy" }
  L("HEALTH: status=$($h.status) | mode=$($h.deploymentMode) | rules=$($h.rulesVersion) | gemini=$($h.gemini.status)")

  $headers = @{ "Content-Type" = "application/json" }
  $script:asserts = [System.Collections.Generic.List[string]]::new()
  function A { param($cond, $label) if ($cond) { $script:asserts.Add("PASS: $label") } else { $script:asserts.Add("FAIL: $label") } }

  # --- 1. Health diagnostics ---
  A ($h.rulesVersion -eq "4.0.0") "Health: rules version is 4.0.0"
  A ($h.deploymentMode -eq "local-first") "Health: deployment mode is local-first"
  A ($h.gemini.configured -eq $false) "Health: Gemini not configured (pending credentials)"
  A ($h.storage.db.writable -eq $true) "Health: DB writable"

  # --- 2. Company + batch ---
  $co = Invoke-RestMethod -Uri "http://localhost:8787/api/companies" -Method Post -Headers $headers -Body (@{ name = "Acme Corp" } | ConvertTo-Json)
  $bat = Invoke-RestMethod -Uri "http://localhost:8787/api/batches" -Method Post -Headers $headers -Body (@{ companyId = $co.id; label = "Q4" } | ConvertTo-Json)
  L("COMPANY: $($co.id) | BATCH: $($bat.id)")

  # --- 3. Screenshot upload ---
  $pngB64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
  $pngPath = Join-Path $env:TEMP "crmfeed_r4_smoke.png"
  [IO.File]::WriteAllBytes($pngPath, [Convert]::FromBase64String($pngB64))
  $upRaw = & curl.exe -s -X POST -F "screenshots=@$pngPath;type=image/png" "http://localhost:8787/api/batches/$($bat.id)/screenshots"
  $up = $upRaw | ConvertFrom-Json
  L("UPLOAD: $($up.screenshots.Count) screenshot(s)")
  $shotId = $up.screenshots[0].id
  A ($up.screenshots.Count -eq 1) "Upload: 1 screenshot uploaded"

  # --- 4. Missing-key Gemini failure ---
  $extractRes = Invoke-RestMethod -Uri "http://localhost:8787/api/extraction/extract/$shotId" -Method Post -Headers $headers
  A ($extractRes.status -eq "failed" -and $extractRes.errorCategory -eq "missing_credentials") "Missing key: extraction fails with missing_credentials"
  L("MISSING KEY: status=$($extractRes.status) error=$($extractRes.errorCategory)")

  # --- 5. Manual extraction import ---
  $run = Invoke-RestMethod -Uri "http://localhost:8787/api/extraction-runs" -Method Post -Headers $headers -Body (@{ batchId = $bat.id; provider = "manual_attach" } | ConvertTo-Json)
  $payload = @{
    targetCompanyName = "Acme Corp"
    screenshots = @()
    people = @(@{
      personId = "p1"; name = "Alice Tan"; headline = "CTO at Acme Corp"; title = "CTO"; location = "Singapore"
      connectionDegree = 2
      currentRoles = @(@{ title = "CTO"; company = "Acme Corp"; evidenceText = "CTO at Acme Corp" })
      pastRoles = @()
      mutualContacts = @{ named = @(@{ name = "Bob Lee" }); vagueCount = $null }
      sourceScreenshotIds = @($shotId); confidence = 0.95
    })
    extractionMeta = @{ provider = "gemini"; overallConfidence = 0.95; extractionWarnings = @() }
  }
  $attachBody = @{ payload = $payload } | ConvertTo-Json -Depth 10
  $attachRes = Invoke-RestMethod -Uri "http://localhost:8787/api/extraction-runs/$($run.id)/payload" -Method Post -Headers $headers -Body $attachBody
  A ($attachRes.run.status -eq "review_ready" -and $attachRes.people.Count -eq 1) "Manual import: 1 person materialized"
  $personId = $attachRes.people[0].id
  L("MANUAL IMPORT: status=$($attachRes.run.status) people=$($attachRes.people.Count)")

  # --- 6. No-bypass-review (email before approval) ---
  $emailBefore = Invoke-RestMethod -Uri "http://localhost:8787/api/email-drafts" -Method Post -Headers $headers -Body (@{ companyId = $co.id } | ConvertTo-Json)
  A (@($emailBefore.personIds).Count -eq 0) "No bypass: email has 0 people before approval"

  # --- 7. Review approval ---
  $rev = Invoke-RestMethod -Uri "http://localhost:8787/api/reviews" -Method Post -Headers $headers -Body (@{ extractedPersonId = $personId; decision = "approved" } | ConvertTo-Json)
  A ($rev.decision -eq "approved") "Review: person approved"

  # --- 8. Audit events ---
  $audit = Invoke-RestMethod -Uri "http://localhost:8787/api/audit?companyId=$($co.id)&limit=10" -Method Get
  $eventCount = @($audit.events).Count
  $hasManual = $false; $hasReview = $false
  foreach ($evt in $audit.events) {
    if ($evt.eventType -eq "manual_extraction_imported") { $hasManual = $true }
    if ($evt.eventType -eq "review_decision_created") { $hasReview = $true }
  }
  A ($eventCount -ge 2) "Audit: at least 2 events recorded"
  A ($hasManual) "Audit: manual_extraction_imported event present"
  A ($hasReview) "Audit: review_decision_created event present"
  L("AUDIT: $eventCount events for company")

  # --- 9. Email after approval (clean Paul email rules) ---
  $emailAfter = Invoke-RestMethod -Uri "http://localhost:8787/api/email-drafts" -Method Post -Headers $headers -Body (@{ companyId = $co.id } | ConvertTo-Json)
  A ($emailAfter.personIds -contains $personId) "Email: person included after approval"
  $body = $emailAfter.body
  A ($body -notmatch "screenshot|OCR|extract|source") "Email: no screenshot/OCR/source wording"
  A ($body -notmatch "\*\*") "Email: no Markdown bold"

  # --- 10. Export creation ---
  $exp = Invoke-RestMethod -Uri "http://localhost:8787/api/exports" -Method Post -Headers $headers -Body (@{ companyId = $co.id } | ConvertTo-Json)
  A ($exp.recordCount -eq 1) "Export: 1 record exported"
  L("EXPORT: $($exp.recordCount) record(s)")

  # --- 11. Export verification (run script) ---
  $verifyRaw = & node "$root\scripts\verify-exports.mjs" 2>&1
  A ($LASTEXITCODE -eq 0) "Export verification: PASS"
  L("EXPORT VERIFY: exit=$LASTEXITCODE")

  # --- 12. Backup creation ---
  $backupRaw = & node "$root\scripts\backup-data.mjs" 2>&1
  A ($LASTEXITCODE -eq 0) "Backup: created"
  L("BACKUP: created")

  # --- 13. Backup verification ---
  $backupVerifyRaw = & node "$root\scripts\verify-backup.mjs" 2>&1
  A ($LASTEXITCODE -eq 0) "Backup verification: PASS"
  L("BACKUP VERIFY: exit=$LASTEXITCODE")

  # --- 14. Company scoping (second company) ---
  $co2 = Invoke-RestMethod -Uri "http://localhost:8787/api/companies" -Method Post -Headers $headers -Body (@{ name = "Beta Inc" } | ConvertTo-Json)
  $exp2 = Invoke-RestMethod -Uri "http://localhost:8787/api/exports" -Method Post -Headers $headers -Body (@{ companyId = $co2.id } | ConvertTo-Json)
  A ($exp2.recordCount -eq 0) "Company scoping: Beta has 0 records (no approved people)"

  # === ASSERTIONS ===
  L("")
  L("=== ASSERTIONS ===")
  foreach ($a in $script:asserts) { L($a) }
  $failCount = ($script:asserts | Where-Object { $_ -like "FAIL:*" }).Count
  $passCount = ($script:asserts | Where-Object { $_ -like "PASS:*" }).Count
  L("")
  L("SMOKE RESULT: $passCount passed, $failCount failed")
  if ($failCount -gt 0) { L("SMOKE TEST FAILED") } else { L("SMOKE TEST DONE - ALL PASSED") }
} finally {
  Stop-Process -Id $api.Id -Force -ErrorAction SilentlyContinue
}
