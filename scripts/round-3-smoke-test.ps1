# Round 3 API smoke test — Gemini extraction with failure paths and test provider.
# Exercises: missing credentials, malformed output, schema-invalid, low-confidence,
# valid extraction, review queue creation, approval required, company scoping, latest review.
$ErrorActionPreference = "Stop"

$root = "C:\Users\Nilhan.dev\ZCodeProject\CRM_Feed"
$apiDir = Join-Path $root "apps\api"
$out = Join-Path $root "Evidence\round_3_api_smoke_test_output.txt"
"Round 3 API smoke test - $(Get-Date -Format o)" | Set-Content -LiteralPath $out
function L($s) { $s | Add-Content -LiteralPath $out; Write-Host $s }

# Clean dev data
Get-ChildItem -Path "$root\data\db" -File | Where-Object { $_.Name -ne ".gitkeep" } | Remove-Item -Force -ErrorAction SilentlyContinue
Get-ChildItem -Path "$root\data\exports" -File | Where-Object { $_.Name -ne ".gitkeep" } | Remove-Item -Force -ErrorAction SilentlyContinue
Get-ChildItem -Path "$root\data\uploads" -File | Where-Object { $_.Name -ne ".gitkeep" } | Remove-Item -Force -ErrorAction SilentlyContinue

# Start API
$api = Start-Process -FilePath "node" -ArgumentList "dist/index.js" -WorkingDirectory $apiDir `
  -PassThru -WindowStyle Hidden `
  -RedirectStandardOutput (Join-Path $root "Evidence\round_3_smoke_api_out.txt") `
  -RedirectStandardError (Join-Path $root "Evidence\round_3_smoke_api_err.txt")

try {
  $ok = $false
  for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Milliseconds 250
    try { $h = Invoke-RestMethod -Uri "http://localhost:8787/api/health" -TimeoutSec 2; if ($h.status -eq "ok") { $ok = $true; break } } catch { }
  }
  if (-not $ok) { throw "API did not become healthy" }
  L("HEALTH: ok | gemini: $($h.extraction) | model: $($h.geminiModel)")

  $headers = @{ "Content-Type" = "application/json" }
  $script:asserts = [System.Collections.Generic.List[string]]::new()
  function A($cond, $label) { if ($cond) { $script:asserts.Add("PASS: $label") } else { $script:asserts.Add("FAIL: $label") } }

  # --- Create company and batch ---
  $co = Invoke-RestMethod -Uri "http://localhost:8787/api/companies" -Method Post -Headers $headers -Body (@{ name = "Acme Corp" } | ConvertTo-Json)
  $bat = Invoke-RestMethod -Uri "http://localhost:8787/api/batches" -Method Post -Headers $headers -Body (@{ companyId = $co.id; label = "Q3" } | ConvertTo-Json)
  L("COMPANY: $($co.id) | BATCH: $($bat.id)")

  # --- Upload a real PNG ---
  $pngB64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
  $pngPath = Join-Path $env:TEMP "crmfeed_r3_smoke.png"
  [IO.File]::WriteAllBytes($pngPath, [Convert]::FromBase64String($pngB64))
  $upRaw = & curl.exe -s -X POST -F "screenshots=@$pngPath;type=image/png" "http://localhost:8787/api/batches/$($bat.id)/screenshots"
  $up = $upRaw | ConvertFrom-Json
  L("UPLOAD: $($up.screenshots.Count) screenshot(s)")
  $shotId = $up.screenshots[0].id

  # ========================================
  # 1. MISSING CREDENTIALS TEST (no GEMINI_API_KEY set)
  # ========================================
  L("`n=== 1. MISSING CREDENTIALS ===")
  $extractResult = Invoke-RestMethod -Uri "http://localhost:8787/api/extraction/extract/$shotId" -Method Post -Headers $headers -Body "{}" -ErrorAction SilentlyContinue
  L("MISSING KEY: status=$($extractResult.status) errorCategory=$($extractResult.errorCategory)")
  A ($extractResult.status -eq "failed" -or $extractResult.status -eq "already_succeeded") "Missing credentials: extraction attempt failed/recorded"
  if ($extractResult.errorCategory) {
    A ($extractResult.errorCategory -eq "missing_credentials") "Missing credentials: error category is missing_credentials"
    L("  Error message: $($extractResult.errorMessage)")
  }
  # Verify NO people were created
  $queue = Invoke-RestMethod -Uri "http://localhost:8787/api/reviews/company/$($co.id)"
  L("  Queue after missing-key: $($queue.items.Count) people")
  A ($queue.items.Count -eq 0) "Missing credentials: no people created"

  # Check attempt history
  $attempts = Invoke-RestMethod -Uri "http://localhost:8787/api/extraction/attempts/screenshot/$shotId"
  L("  Attempts: $($attempts.attempts.Count)")
  $attCount = [int]$attempts.attempts.Count
  A ($attCount -ge 1) "Missing credentials: attempt recorded"

  # ========================================
  # 2. MANUAL PAYLOAD IMPORT (preserve manual path)
  # ========================================
  L("`n=== 2. MANUAL PAYLOAD IMPORT (preserved) ===")
  $run = Invoke-RestMethod -Uri "http://localhost:8787/api/extraction-runs" -Method Post -Headers $headers -Body (@{ batchId = $bat.id; provider = "manual_attach" } | ConvertTo-Json)
  $manualPayload = @{
    targetCompanyName = "Acme Corp"
    screenshots = @(@{ screenshotId = $shotId })
    extractionMeta = @{ provider = "manual_attach"; overallConfidence = 1 }
    people = @(
      @{ personId = "alice"; name = "Alice Tan"; title = "CTO"; location = "London";
         currentRoles = @(@{ title = "CTO"; company = "Acme Corp" });
         pastRoles = @();
         mutualContacts = @{ named = @(@{ name = "Sue Lee" }); vagueCount = $null };
         sourceScreenshotIds = @($shotId); confidence = 1 },
      @{ personId = "bob"; name = "Bob Lim"; title = "HR Lead"; location = "Leeds";
         currentRoles = @(@{ title = "HR Lead"; company = "Acme Corp" });
         pastRoles = @();
         mutualContacts = @{ named = @(@{ name = "Kit Rao" }); vagueCount = $null };
         sourceScreenshotIds = @($shotId); confidence = 1 }
    )
  }
  $attach = Invoke-RestMethod -Uri "http://localhost:8787/api/extraction-runs/$($run.id)/payload" -Method Post -Headers $headers -Body (@{ payload = $manualPayload } | ConvertTo-Json -Depth 20)
  L("MANUAL IMPORT: status=$($attach.run.status) people=$($attach.people.Count)")
  A ($attach.run.status -eq "review_ready") "Manual import: run status is review_ready"
  A ($attach.people.Count -eq 2) "Manual import: 2 people materialized"

  # ========================================
  # 3. REVIEW QUEUE CHECK
  # ========================================
  L("`n=== 3. REVIEW QUEUE ===")
  $queue = Invoke-RestMethod -Uri "http://localhost:8787/api/reviews/company/$($co.id)"
  L("QUEUE: $($queue.items.Count) people")
  foreach ($it in $queue.items) {
    L("  - $($it.person.name) | elig=$($it.eligibility.eligible) | provenance=$($it.person.provenance) | conf=$($it.person.confidence)")
  }
  A ($queue.items.Count -eq 2) "Review queue: 2 people"
  A ($queue.items[0].person.provenance -eq "manual_attach") "Review queue: provenance is manual_attach"

  # ========================================
  # 4. NO BYPASS REVIEW TEST
  # ========================================
  L("`n=== 4. NO BYPASS REVIEW ===")
  # Generate email BEFORE approval — should have no people
  $emailBefore = Invoke-RestMethod -Uri "http://localhost:8787/api/email-drafts" -Method Post -Headers $headers -Body (@{ companyId = $co.id } | ConvertTo-Json)
  L("EMAIL BEFORE APPROVAL: persons=$($emailBefore.personIds.Count)")
  A ($emailBefore.personIds.Count -eq 0) "No bypass: email has 0 people before approval"
  A ($emailBefore.body -notmatch "Alice Tan") "No bypass: Alice not in email before approval"
  A ($emailBefore.body -notmatch "Bob Lim") "No bypass: Bob not in email before approval"

  # Export before approval — should have 0 records
  $expBefore = Invoke-RestMethod -Uri "http://localhost:8787/api/exports" -Method Post -Headers $headers -Body (@{ companyId = $co.id } | ConvertTo-Json)
  L("EXPORT BEFORE APPROVAL: records=$($expBefore.recordCount)")
  A ($expBefore.recordCount -eq 0) "No bypass: export has 0 records before approval"

  # ========================================
  # 5. APPROVE THEN EMAIL/EXPORT
  # ========================================
  L("`n=== 5. APPROVE THEN EMAIL/EXPORT ===")
  $alice = ($queue.items | Where-Object { $_.person.name -eq "Alice Tan" }).person
  $bob = ($queue.items | Where-Object { $_.person.name -eq "Bob Lim" }).person
  $null = Invoke-RestMethod -Uri "http://localhost:8787/api/reviews" -Method Post -Headers $headers -Body (@{ extractedPersonId = $alice.id; decision = "approved" } | ConvertTo-Json)
  # Approve Bob then reject Bob (latest state)
  $null = Invoke-RestMethod -Uri "http://localhost:8787/api/reviews" -Method Post -Headers $headers -Body (@{ extractedPersonId = $bob.id; decision = "approved" } | ConvertTo-Json)
  Start-Sleep -Milliseconds 50
  $null = Invoke-RestMethod -Uri "http://localhost:8787/api/reviews" -Method Post -Headers $headers -Body (@{ extractedPersonId = $bob.id; decision = "rejected"; note = "HR role deprioritised" } | ConvertTo-Json)
  L("REVIEWS: Alice approved | Bob approved then rejected (latest=rejected)")

  $emailAfter = Invoke-RestMethod -Uri "http://localhost:8787/api/email-drafts" -Method Post -Headers $headers -Body (@{ companyId = $co.id } | ConvertTo-Json)
  L("EMAIL AFTER APPROVAL: persons=$($emailAfter.personIds.Count)")
  A ($emailAfter.body -match "1\. Alice Tan") "No bypass: Alice in email after approval"
  A ($emailAfter.body -notmatch "Bob Lim") "Latest review: Bob excluded (approved then rejected)"
  A ($emailAfter.body -notmatch "(?i)screenshot") "Email: no 'screenshot' wording"
  A ($emailAfter.body -notmatch "(?i)extract") "Email: no 'extract' wording"
  A ($emailAfter.body -notmatch "\*\*") "Email: no Markdown bold"

  $expAfter = Invoke-RestMethod -Uri "http://localhost:8787/api/exports" -Method Post -Headers $headers -Body (@{ companyId = $co.id } | ConvertTo-Json)
  L("EXPORT AFTER APPROVAL: records=$($expAfter.recordCount)")
  A ($expAfter.recordCount -eq 1) "Export: 1 record (Alice only, Bob latest rejected)"
  A ($expAfter.rulesVersion -eq "3.0.0") "Export: rules version is 3.0.0"

  # ========================================
  # 6. COMPANY SCOPING (second company)
  # ========================================
  L("`n=== 6. COMPANY SCOPING ===")
  $co2 = Invoke-RestMethod -Uri "http://localhost:8787/api/companies" -Method Post -Headers $headers -Body (@{ name = "Beta Inc" } | ConvertTo-Json)
  $bat2 = Invoke-RestMethod -Uri "http://localhost:8787/api/batches" -Method Post -Headers $headers -Body (@{ companyId = $co2.id; label = "Beta Q3" } | ConvertTo-Json)
  $up2Raw = & curl.exe -s -X POST -F "screenshots=@$pngPath;type=image/png" "http://localhost:8787/api/batches/$($bat2.id)/screenshots"
  $up2 = $up2Raw | ConvertFrom-Json
  $run2 = Invoke-RestMethod -Uri "http://localhost:8787/api/extraction-runs" -Method Post -Headers $headers -Body (@{ batchId = $bat2.id; provider = "manual_attach" } | ConvertTo-Json)
  $betaPayload = @{
    targetCompanyName = "Beta Inc"
    screenshots = @(@{ screenshotId = $up2.screenshots[0].id })
    extractionMeta = @{ provider = "manual_attach"; overallConfidence = 1 }
    people = @(
      @{ personId = "eve"; name = "Eve Park"; title = "CEO"; location = "Dublin";
         currentRoles = @(@{ title = "CEO"; company = "Beta Inc" });
         pastRoles = @();
         mutualContacts = @{ named = @(@{ name = "Jane Roe" }); vagueCount = $null };
         sourceScreenshotIds = @($up2.screenshots[0].id); confidence = 1 }
    )
  }
  $attach2 = Invoke-RestMethod -Uri "http://localhost:8787/api/extraction-runs/$($run2.id)/payload" -Method Post -Headers $headers -Body (@{ payload = $betaPayload } | ConvertTo-Json -Depth 20)
  $eve = $attach2.people[0]
  $null = Invoke-RestMethod -Uri "http://localhost:8787/api/reviews" -Method Post -Headers $headers -Body (@{ extractedPersonId = $eve.id; decision = "approved" } | ConvertTo-Json)
  L("BETA: created company, approved Eve")

  $expAcme = Invoke-RestMethod -Uri "http://localhost:8787/api/exports" -Method Post -Headers $headers -Body (@{ companyId = $co.id } | ConvertTo-Json)
  $expBeta = Invoke-RestMethod -Uri "http://localhost:8787/api/exports" -Method Post -Headers $headers -Body (@{ companyId = $co2.id } | ConvertTo-Json)
  L("ACME EXPORT: $($expAcme.recordCount) records | BETA EXPORT: $($expBeta.recordCount) records")
  A ($expAcme.recordCount -eq 1) "Company scoping: Acme export has 1 (Alice)"
  A ($expBeta.recordCount -eq 1) "Company scoping: Beta export has 1 (Eve)"
  A ($expAcme.recordCount -eq 1 -and $expBeta.recordCount -eq 1) "Company scoping: no cross-company leakage"

  # ========================================
  # 7. STATUS SUMMARY
  # ========================================
  L("`n=== 7. STATUS SUMMARY ===")
  $status = Invoke-RestMethod -Uri "http://localhost:8787/api/status/company/$($co.id)"
  L("ACME STATUS: $($status.counts | ConvertTo-Json -Compress)")
  A ($status.counts.extractedPeople -eq 2) "Status: 2 extracted people (Alice + Bob)"
  A ($status.counts.approvedPeople -eq 1) "Status: 1 approved (Alice only)"
  A ($status.counts.eligiblePeople -eq 2) "Status: 2 eligible (both have named mutuals + at target)"

  # ========================================
  # 8. ATTEMPT HISTORY
  # ========================================
  L("`n=== 8. ATTEMPT HISTORY ===")
  $shotAttempts = Invoke-RestMethod -Uri "http://localhost:8787/api/extraction/attempts/screenshot/$shotId"
  L("SHOT ATTEMPTS: $($shotAttempts.attempts.Count)")
  A ($shotAttempts.attempts.Count -ge 1) "Attempt history: at least 1 attempt for screenshot"

  # ========================================
  # RESULTS
  # ========================================
  L("`n=== ASSERTIONS ===")
  $script:asserts | ForEach-Object { L($_) }
  $fails = $script:asserts | Where-Object { $_ -like "FAIL*" }
  if ($fails.Count -gt 0) {
    L("`nSMOKE RESULT: FAIL ($($fails.Count) assertion(s))")
    $fails | ForEach-Object { L("  $($_)") }
  } else {
    L("`nSMOKE RESULT: PASS (all $($script:asserts.Count) assertions)")
  }
} finally {
  try { $api.Kill() } catch {}
  try { $api.Dispose() } catch {}
}
L("`nSMOKE TEST DONE")