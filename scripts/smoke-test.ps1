# Real end-to-end smoke test for CRM Feed API (no mocks).
# Starts the built API, exercises every endpoint against the real atomic JSON
# store, verifies persistence files on disk, then stops the API.
$ErrorActionPreference = "Stop"

$root = "C:\Users\Nilhan.dev\ZCodeProject\CRM_Feed"
$apiDir = Join-Path $root "apps\api"
$out = Join-Path $root "Evidence\smoke_test.txt"
"CRM Feed API smoke test - $(Get-Date -Format o)" | Set-Content -LiteralPath $out
function L($s) { $s | Add-Content -LiteralPath $out; Write-Host $s }

# Clean any prior dev data so the test is deterministic (preserve .gitkeep).
Get-ChildItem -Path (Join-Path $root "data\db") -File | Where-Object { $_.Name -ne ".gitkeep" } | Remove-Item -Force -ErrorAction SilentlyContinue
Get-ChildItem -Path (Join-Path $root "data\exports") -File | Where-Object { $_.Name -ne ".gitkeep" } | Remove-Item -Force -ErrorAction SilentlyContinue
Get-ChildItem -Path (Join-Path $root "data\uploads") -File | Where-Object { $_.Name -ne ".gitkeep" } | Remove-Item -Force -ErrorAction SilentlyContinue

# Start API.
$api = Start-Process -FilePath "node" -ArgumentList "dist/index.js" -WorkingDirectory $apiDir `
  -PassThru -WindowStyle Hidden `
  -RedirectStandardOutput (Join-Path $root "Evidence\smoke_api_out.txt") `
  -RedirectStandardError (Join-Path $root "Evidence\smoke_api_err.txt")

try {
  # Wait for health.
  $ok = $false
  for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Milliseconds 250
    try {
      $h = Invoke-RestMethod -Uri "http://localhost:8787/api/health" -TimeoutSec 2
      if ($h.status -eq "ok") { $ok = $true; break }
    } catch { }
  }
  if (-not $ok) { throw "API did not become healthy" }
  L("HEALTH: ok -> $($h | ConvertTo-Json -Compress)")

  $headers = @{ "Content-Type" = "application/json" }

  # 1. Create company.
  $co = Invoke-RestMethod -Uri "http://localhost:8787/api/companies" -Method Post -Headers $headers `
    -Body (@{ name = "Acme Corp"; website = "https://acme.example" } | ConvertTo-Json)
  L("COMPANY: $($co.id) name=$($co.name)")

  # 2. Create batch.
  $bat = Invoke-RestMethod -Uri "http://localhost:8787/api/batches" -Method Post -Headers $headers `
    -Body (@{ companyId = $co.id; label = "Q3 intake" } | ConvertTo-Json)
  L("BATCH: $($bat.id) status=$($bat.status)")

  # 3. Upload a real 1x1 PNG screenshot.
  $pngB64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
  $pngPath = Join-Path $env:TEMP "crmfeed_smoke.png"
  [IO.File]::WriteAllBytes($pngPath, [Convert]::FromBase64String($pngB64))
  $upRaw = & curl.exe -s -X POST -F "screenshots=@$pngPath;type=image/png" "http://localhost:8787/api/batches/$($bat.id)/screenshots"
  $up = $upRaw | ConvertFrom-Json
  L("UPLOAD: $($up.screenshots.Count) file(s); sha256=$($up.screenshots[0].sha256.Substring(0,12))")

  # 4. Create extraction run (should be pending_credentials).
  $run = Invoke-RestMethod -Uri "http://localhost:8787/api/extraction-runs" -Method Post -Headers $headers `
    -Body (@{ batchId = $bat.id; provider = "manual_attach" } | ConvertTo-Json)
  L("RUN: $($run.id) status=$($run.status) provider=$($run.provider)")

  # 5. Attach a REAL extraction payload (Alice eligible, Bob past-only, Cara no-named, Dan capped mutuals).
  $payload = @{
    targetCompanyName = "Acme Corp"
    screenshots = @(@{ screenshotId = $up.screenshots[0].id })
    extractionMeta = @{ provider = "manual_attach"; providerRunId = $null; overallConfidence = 1 }
    people = @(
      @{ personId = "alice"; name = "Alice Tan"; title = "Chief Technology Officer"; location = "London, UK";
         currentRoles = @(@{ title = "CTO"; company = "Acme Corp" });
         pastRoles = @();
         mutualContacts = @{ named = @(@{ name = "Sue Lee" }, @{ name = "Tom Ng" }); vagueCount = $null };
         sourceScreenshotIds = @($up.screenshots[0].id); confidence = 1 },
      @{ personId = "bob"; name = "Bob Lim"; title = "Engineer"; location = "Manchester";
         currentRoles = @(@{ title = "Engineer"; company = "Other Co" });
         pastRoles = @(@{ title = "Engineer"; company = "Acme Corp" });
         mutualContacts = @{ named = @(@{ name = "Kit" }); vagueCount = $null };
         sourceScreenshotIds = @($up.screenshots[0].id); confidence = 0.8 },
      @{ personId = "cara"; name = "Cara Ng"; title = "HR Partner"; location = "Leeds";
         currentRoles = @(@{ title = "HR Partner"; company = "Acme Corp" });
         pastRoles = @();
         mutualContacts = @{ named = @(); vagueCount = 3 };
         sourceScreenshotIds = @($up.screenshots[0].id); confidence = 0.7 },
      @{ personId = "dan"; name = "Dan Cho"; title = "Chief Operating Officer"; location = "Bristol";
         currentRoles = @(@{ title = "COO"; company = "Acme Corp" });
         pastRoles = @();
         mutualContacts = @{ named = @(@{name="M1"},@{name="M2"},@{name="M3"},@{name="M4"},@{name="M5"},@{name="M6"},@{name="M7"},@{name="M8"}); vagueCount = $null };
         sourceScreenshotIds = @($up.screenshots[0].id); confidence = 0.9 }
    )
  }
  $attach = Invoke-RestMethod -Uri "http://localhost:8787/api/extraction-runs/$($run.id)/payload" -Method Post -Headers $headers `
    -Body (@{ payload = $payload } | ConvertTo-Json -Depth 20)
  L("ATTACH: run.status=$($attach.run.status) people=$($attach.people.Count) target=$($attach.targetCompanyName)")

  # 6. Review queue.
  $q = Invoke-RestMethod -Uri "http://localhost:8787/api/reviews/company/$($co.id)"
  L("QUEUE: $($q.items.Count) people")
  foreach ($it in $q.items) {
    L("  - $($it.person.name) | eligible=$($it.eligibility.eligible) | namedMutuals=" + (($it.mutuals | Where-Object { -not $_.excludedFromEmail -and $_.name -ne "__vague_count__" }).Count))
  }

  # 7. Approve Alice and Dan.
  $aliceId = ($q.items | Where-Object { $_.person.name -eq "Alice Tan" }).person.id
  $danId = ($q.items | Where-Object { $_.person.name -eq "Dan Cho" }).person.id
  $null = Invoke-RestMethod -Uri "http://localhost:8787/api/reviews" -Method Post -Headers $headers -Body (@{ extractedPersonId = $aliceId; decision = "approved" } | ConvertTo-Json)
  $null = Invoke-RestMethod -Uri "http://localhost:8787/api/reviews" -Method Post -Headers $headers -Body (@{ extractedPersonId = $danId; decision = "approved" } | ConvertTo-Json)
  L("REVIEWS: approved Alice + Dan")

  # 8. Generate email draft.
  $email = Invoke-RestMethod -Uri "http://localhost:8787/api/email-drafts" -Method Post -Headers $headers -Body (@{ companyId = $co.id } | ConvertTo-Json)
  L("EMAIL: draft=$($email.id) persons=$($email.personIds.Count)")
  L("---- EMAIL BODY ----")
  $email.body | Add-Content -LiteralPath $out
  Write-Host $email.body
  L("---- END BODY ----")

  # 9. Export.
  $exp = Invoke-RestMethod -Uri "http://localhost:8787/api/exports" -Method Post -Headers $headers -Body (@{ companyId = $co.id } | ConvertTo-Json)
  L("EXPORT: records=$($exp.recordCount) json=$($exp.exportJson) csv=$($exp.exportCsv)")

  # 10. Verify persistence files on disk.
  $dbFiles = Get-ChildItem -LiteralPath (Join-Path $root "data\db") -Filter *.json
  L("PERSISTENCE: db files = " + ($dbFiles.Name -join ", "))
  $expFiles = Get-ChildItem -LiteralPath (Join-Path $root "data\exports")
  L("PERSISTENCE: export files = " + ($expFiles.Name -join ", "))
  $upFiles = Get-ChildItem -LiteralPath (Join-Path $root "data\uploads")
  L("PERSISTENCE: upload files = " + ($upFiles.Count))

  # 11. Assertions on email correctness.
  $body = $email.body
  $script:asserts = [System.Collections.Generic.List[string]]::new()
  function A($cond, $label) {
    if ($cond) { $script:asserts.Add("PASS: $label") } else { $script:asserts.Add("FAIL: $label") }
  }
  A($body -match "Hi Paul,") "greeting present"
  A($body -match "Best,") "signature present"
  A($body -match "Nilhan") "Nilhan present"
  A($body -match "1\. Alice Tan") "Alice present (approved + at target)"
  A($body -match "2\. Dan Cho") "Dan present (COO, approved)"
  A($body -notmatch "Bob Lim") "Bob excluded (past-only)"
  A($body -notmatch "Cara Ng") "Cara excluded (no named mutual)"
  A($body -notmatch "M8") "Dan mutuals capped at 7 (M8 excluded)"
  A($body -notmatch "(?i)screenshot") "no 'screenshot' wording"
  A($body -notmatch "(?i)ocr") "no 'ocr' wording"
  A($body -notmatch "(?i)extract") "no 'extract' wording"
  A($body -notmatch "\*\*") "no Markdown bold"
  L("---- ASSERTIONS ----")
  $script:asserts | ForEach-Object { L($_) }
  $fails = $script:asserts | Where-Object { $_ -like "FAIL*" }
  if ($fails.Count -gt 0) { L("SMOKE RESULT: FAIL ($($fails.Count) assertion(s))") } else { L("SMOKE RESULT: PASS (all assertions)") }
}
finally {
  try { $api.Kill() } catch {}
  try { $api.Dispose() } catch {}
}
L("SMOKE TEST DONE")
