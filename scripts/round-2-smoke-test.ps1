# Round 2 API smoke test — full real workflow with latest-review and company-scoping.
# Exercises: create company, create batch, upload screenshot, create extraction run,
# attach real payload, list review queue, approve, reject, approve-then-reject,
# generate email, generate export, assert company scoping, assert latest-rejected excluded.
$ErrorActionPreference = "Stop"

$root = "C:\Users\Nilhan.dev\ZCodeProject\CRM_Feed"
$apiDir = Join-Path $root "apps\api"
$out = Join-Path $root "Evidence\round_2_api_smoke_test_output.txt"
"Round 2 API smoke test - $(Get-Date -Format o)" | Set-Content -LiteralPath $out
function L($s) { $s | Add-Content -LiteralPath $out; Write-Host $s }

# Clean dev data
Get-ChildItem -Path "$root\data\db" -File | Where-Object { $_.Name -ne ".gitkeep" } | Remove-Item -Force -ErrorAction SilentlyContinue
Get-ChildItem -Path "$root\data\exports" -File | Where-Object { $_.Name -ne ".gitkeep" } | Remove-Item -Force -ErrorAction SilentlyContinue
Get-ChildItem -Path "$root\data\uploads" -File | Where-Object { $_.Name -ne ".gitkeep" } | Remove-Item -Force -ErrorAction SilentlyContinue

# Start API
$api = Start-Process -FilePath "node" -ArgumentList "dist/index.js" -WorkingDirectory $apiDir `
  -PassThru -WindowStyle Hidden `
  -RedirectStandardOutput (Join-Path $root "Evidence\round_2_smoke_api_out.txt") `
  -RedirectStandardError (Join-Path $root "Evidence\round_2_smoke_api_err.txt")

try {
  $ok = $false
  for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Milliseconds 250
    try { $h = Invoke-RestMethod -Uri "http://localhost:8787/api/health" -TimeoutSec 2; if ($h.status -eq "ok") { $ok = $true; break } } catch { }
  }
  if (-not $ok) { throw "API did not become healthy" }
  L("HEALTH: ok")

  $headers = @{ "Content-Type" = "application/json" }

  # Create TWO companies to test company scoping
  $co1 = Invoke-RestMethod -Uri "http://localhost:8787/api/companies" -Method Post -Headers $headers -Body (@{ name = "Acme Corp" } | ConvertTo-Json)
  $co2 = Invoke-RestMethod -Uri "http://localhost:8787/api/companies" -Method Post -Headers $headers -Body (@{ name = "Beta Inc" } | ConvertTo-Json)
  L("COMPANIES: co1=$($co1.id) Acme | co2=$($co2.id) Beta")

  # Create batches for both
  $bat1 = Invoke-RestMethod -Uri "http://localhost:8787/api/batches" -Method Post -Headers $headers -Body (@{ companyId = $co1.id; label = "Acme Q3" } | ConvertTo-Json)
  $bat2 = Invoke-RestMethod -Uri "http://localhost:8787/api/batches" -Method Post -Headers $headers -Body (@{ companyId = $co2.id; label = "Beta Q3" } | ConvertTo-Json)
  L("BATCHES: bat1=$($bat1.id) | bat2=$($bat2.id)")

  # Upload screenshots to both batches
  $pngB64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
  $pngPath = Join-Path $env:TEMP "crmfeed_r2_smoke.png"
  [IO.File]::WriteAllBytes($pngPath, [Convert]::FromBase64String($pngB64))
  $up1Raw = & curl.exe -s -X POST -F "screenshots=@$pngPath;type=image/png" "http://localhost:8787/api/batches/$($bat1.id)/screenshots"
  $up1 = $up1Raw | ConvertFrom-Json
  $up2Raw = & curl.exe -s -X POST -F "screenshots=@$pngPath;type=image/png" "http://localhost:8787/api/batches/$($bat2.id)/screenshots"
  $up2 = $up2Raw | ConvertFrom-Json
  L("UPLOADS: acme=$($up1.screenshots.Count) | beta=$($up2.screenshots.Count)")

  # Create extraction runs for both
  $run1 = Invoke-RestMethod -Uri "http://localhost:8787/api/extraction-runs" -Method Post -Headers $headers -Body (@{ batchId = $bat1.id; provider = "manual_attach" } | ConvertTo-Json)
  $run2 = Invoke-RestMethod -Uri "http://localhost:8787/api/extraction-runs" -Method Post -Headers $headers -Body (@{ batchId = $bat2.id; provider = "manual_attach" } | ConvertTo-Json)
  L("RUNS: run1=$($run1.id) status=$($run1.status) | run2=$($run2.id)")

  # Attach payload to Acme: Alice (CTO, eligible), Bob (past-only), Cara (no mutuals), Dan (COO, approved-then-rejected)
  $acmePayload = @{
    targetCompanyName = "Acme Corp"
    screenshots = @(@{ screenshotId = $up1.screenshots[0].id })
    extractionMeta = @{ provider = "manual_attach"; overallConfidence = 1 }
    people = @(
      @{ personId = "alice"; name = "Alice Tan"; title = "Chief Technology Officer"; location = "London, UK";
         currentRoles = @(@{ title = "CTO"; company = "Acme Corp" });
         pastRoles = @();
         mutualContacts = @{ named = @(@{ name = "Sue Lee" }, @{ name = "Tom Ng" }); vagueCount = $null };
         sourceScreenshotIds = @($up1.screenshots[0].id); confidence = 1 },
      @{ personId = "bob"; name = "Bob Lim"; title = "Engineer"; location = "Manchester";
         currentRoles = @(@{ title = "Engineer"; company = "Other Co" });
         pastRoles = @(@{ title = "Engineer"; company = "Acme Corp" });
         mutualContacts = @{ named = @(@{ name = "Kit" }); vagueCount = $null };
         sourceScreenshotIds = @($up1.screenshots[0].id); confidence = 0.8 },
      @{ personId = "cara"; name = "Cara Ng"; title = "HR Partner"; location = "Leeds";
         currentRoles = @(@{ title = "HR Partner"; company = "Acme Corp" });
         pastRoles = @();
         mutualContacts = @{ named = @(); vagueCount = 3 };
         sourceScreenshotIds = @($up1.screenshots[0].id); confidence = 0.7 },
      @{ personId = "dan"; name = "Dan Cho"; title = "Chief Operating Officer"; location = "Bristol";
         currentRoles = @(@{ title = "COO"; company = "Acme Corp" });
         pastRoles = @();
         mutualContacts = @{ named = @(@{name="M1"},@{name="M2"},@{name="M3"},@{name="M4"},@{name="M5"},@{name="M6"},@{name="M7"},@{name="M8"}); vagueCount = $null };
         sourceScreenshotIds = @($up1.screenshots[0].id); confidence = 0.9 }
    )
  }
  $attach1 = Invoke-RestMethod -Uri "http://localhost:8787/api/extraction-runs/$($run1.id)/payload" -Method Post -Headers $headers -Body (@{ payload = $acmePayload } | ConvertTo-Json -Depth 20)
  L("ATTACH ACME: status=$($attach1.run.status) people=$($attach1.people.Count)")

  # Attach payload to Beta: Eve (CEO, eligible, approved) — this person must NOT appear in Acme export
  $betaPayload = @{
    targetCompanyName = "Beta Inc"
    screenshots = @(@{ screenshotId = $up2.screenshots[0].id })
    extractionMeta = @{ provider = "manual_attach"; overallConfidence = 1 }
    people = @(
      @{ personId = "eve"; name = "Eve Park"; title = "Chief Executive Officer"; location = "Dublin";
         currentRoles = @(@{ title = "CEO"; company = "Beta Inc" });
         pastRoles = @();
         mutualContacts = @{ named = @(@{ name = "Jane Roe" }); vagueCount = $null };
         sourceScreenshotIds = @($up2.screenshots[0].id); confidence = 1 }
    )
  }
  $attach2 = Invoke-RestMethod -Uri "http://localhost:8787/api/extraction-runs/$($run2.id)/payload" -Method Post -Headers $headers -Body (@{ payload = $betaPayload } | ConvertTo-Json -Depth 20)
  L("ATTACH BETA: status=$($attach2.run.status) people=$($attach2.people.Count)")

  # Review queue for Acme
  $q1 = Invoke-RestMethod -Uri "http://localhost:8787/api/reviews/company/$($co1.id)"
  L("ACME QUEUE: $($q1.items.Count) people")
  foreach ($it in $q1.items) {
    L("  - $($it.person.name) | elig=$($it.eligibility.eligible) | review=$($it.reviewState.latestDecision) | dup=$($it.isDuplicateCandidate) | score=$($it.rankScore)")
  }

  # Get Alice and Dan person IDs
  $alice = ($q1.items | Where-Object { $_.person.name -eq "Alice Tan" }).person
  $dan = ($q1.items | Where-Object { $_.person.name -eq "Dan Cho" }).person
  $bob = ($q1.items | Where-Object { $_.person.name -eq "Bob Lim" }).person
  $cara = ($q1.items | Where-Object { $_.person.name -eq "Cara Ng" }).person

  # Approve Alice
  $null = Invoke-RestMethod -Uri "http://localhost:8787/api/reviews" -Method Post -Headers $headers -Body (@{ extractedPersonId = $alice.id; decision = "approved" } | ConvertTo-Json)
  L("REVIEW: Alice approved")

  # Approve Dan, THEN reject Dan (to prove latest-rejection wins)
  $null = Invoke-RestMethod -Uri "http://localhost:8787/api/reviews" -Method Post -Headers $headers -Body (@{ extractedPersonId = $dan.id; decision = "approved" } | ConvertTo-Json)
  L("REVIEW: Dan approved (first)")
  Start-Sleep -Milliseconds 100
  $null = Invoke-RestMethod -Uri "http://localhost:8787/api/reviews" -Method Post -Headers $headers -Body (@{ extractedPersonId = $dan.id; decision = "rejected"; note = "Changed my mind" } | ConvertTo-Json)
  L("REVIEW: Dan rejected (latest — should win)")

  # Approve Eve (Beta company)
  $q2 = Invoke-RestMethod -Uri "http://localhost:8787/api/reviews/company/$($co2.id)"
  $eve = ($q2.items | Where-Object { $_.person.name -eq "Eve Park" }).person
  $null = Invoke-RestMethod -Uri "http://localhost:8787/api/reviews" -Method Post -Headers $headers -Body (@{ extractedPersonId = $eve.id; decision = "approved" } | ConvertTo-Json)
  L("REVIEW: Eve (Beta) approved")

  # Check Dan's review history
  $danHist = Invoke-RestMethod -Uri "http://localhost:8787/api/reviews/person/$($dan.id)/history"
  L("DAN HISTORY: $($danHist.decisions.Count) decisions, latest=$($danHist.decisions[-1].decision)")

  # Status summary for Acme
  $status1 = Invoke-RestMethod -Uri "http://localhost:8787/api/status/company/$($co1.id)"
  L("ACME STATUS: $($status1.counts | ConvertTo-Json -Compress)")

  # Generate email for Acme
  $email1 = Invoke-RestMethod -Uri "http://localhost:8787/api/email-drafts" -Method Post -Headers $headers -Body (@{ companyId = $co1.id } | ConvertTo-Json)
  L("ACME EMAIL: draft=$($email1.id) persons=$($email1.personIds.Count)")
  L("---- ACME EMAIL BODY ----")
  $email1.body | Add-Content -LiteralPath $out
  Write-Host $email1.body
  L("---- END BODY ----")

  # Generate export for Acme
  $exp1 = Invoke-RestMethod -Uri "http://localhost:8787/api/exports" -Method Post -Headers $headers -Body (@{ companyId = $co1.id } | ConvertTo-Json)
  L("ACME EXPORT: id=$($exp1.exportId) records=$($exp1.recordCount) json=$($exp1.exportJson)")

  # Generate export for Beta
  $exp2 = Invoke-RestMethod -Uri "http://localhost:8787/api/exports" -Method Post -Headers $headers -Body (@{ companyId = $co2.id } | ConvertTo-Json)
  L("BETA EXPORT: id=$($exp2.exportId) records=$($exp2.recordCount)")

  # ---- ASSERTIONS ----
  $body = $email1.body
  $script:asserts = [System.Collections.Generic.List[string]]::new()
  function A($cond, $label) { if ($cond) { $script:asserts.Add("PASS: $label") } else { $script:asserts.Add("FAIL: $label") } }

  A($body -match "Hi Paul,") "greeting present"
  A($body -match "1\. Alice Tan") "Alice present (approved, at target, named mutuals)"
  A($body -notmatch "Bob Lim") "Bob excluded (past-only)"
  A($body -notmatch "Cara Ng") "Cara excluded (no named mutuals)"
  A($body -notmatch "Dan Cho") "Dan excluded (approved then rejected — latest state)"
  A($body -notmatch "Eve Park") "Eve excluded (different company — company scoping)"
  A($body -notmatch "M8") "Dan mutuals not present (Dan excluded entirely)"
  A($body -notmatch "(?i)screenshot") "no 'screenshot' wording"
  A($body -notmatch "(?i)ocr") "no 'ocr' wording"
  A($body -notmatch "(?i)extract") "no 'extract' wording"
  A($body -notmatch "\*\*") "no Markdown bold"

  # Company scoping: Acme export should NOT contain Eve
  A($exp1.recordCount -eq 1) "Acme export has exactly 1 record (Alice only, Dan latest-rejected)"
  A($exp2.recordCount -eq 1) "Beta export has exactly 1 record (Eve)"

  # Latest review: Dan's history has 2 decisions, latest is rejected
  A($danHist.decisions.Count -eq 2) "Dan has 2 review decisions"
  A($danHist.decisions[-1].decision -eq "rejected") "Dan latest decision is rejected"

  # Status summary counts
  A($status1.counts.extractedPeople -eq 4) "Acme has 4 extracted people"
  A($status1.counts.eligiblePeople -eq 2) "Acme has 2 eligible (Alice + Dan)"
  A($status1.counts.approvedPeople -eq 1) "Acme has 1 approved (Alice only — Dan latest is rejected)"
  A($status1.counts.exportReadyPeople -eq 1) "Acme has 1 export-ready (Alice)"

  L("---- ASSERTIONS ----")
  $script:asserts | ForEach-Object { L($_) }
  $fails = $script:asserts | Where-Object { $_ -like "FAIL*" }
  if ($fails.Count -gt 0) { L("SMOKE RESULT: FAIL ($($fails.Count) assertion(s))") } else { L("SMOKE RESULT: PASS (all $($script:asserts.Count) assertions)") }
}
finally {
  try { $api.Kill() } catch {}
  try { $api.Dispose() } catch {}
}
L("SMOKE TEST DONE")
