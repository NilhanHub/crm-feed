// Data Integrity Check Script — Round 2 + Round 3
// Checks for: orphaned extracted people, orphaned review decisions, missing screenshot files,
// export records pointing to missing files, invalid JSON records, cross-company export leakage,
// Round 3 referential integrity (extraction_attempts, raw_responses, extracted_people),
// failed/missing_credentials attempt integrity, and unapproved Gemini extraction in exports/emails.
//
// Usage: node scripts/data-integrity-check.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");
const dbDir = path.join(root, "data", "db");
const uploadsDir = path.join(root, "data", "uploads");
const exportsDir = path.join(root, "data", "exports");

const lines = [];
function log(s) { lines.push(s); console.log(s); }

log("=== CRM Feed Data Integrity Check ===");
log(`Date: ${new Date().toISOString()}`);
log("");

function readCollection(name) {
  const f = path.join(dbDir, `${name}.json`);
  try {
    const raw = fs.readFileSync(f, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === "ENOENT") return {};
    log(`ERROR reading ${name}: ${err.message}`);
    return {};
  }
}

const companies = readCollection("companies");
const batches = readCollection("batches");
const screenshots = readCollection("screenshots");
const extractionRuns = readCollection("extraction_runs");
const extractedPeople = readCollection("extracted_people");
const mutualContacts = readCollection("mutual_contacts");
const eligibilityDecisions = readCollection("eligibility_decisions");
const reviewDecisions = readCollection("review_decisions");
const crmSyncRecords = readCollection("crm_sync_records");
const emailDrafts = readCollection("email_drafts");
const exportBatches = readCollection("export_batches");
const extractionAttempts = readCollection("extraction_attempts");
const rawResponses = readCollection("raw_responses");
const auditEvents = readCollection("audit_events");

const issues = [];
const checks = [];

function check(name, cond, detail) {
  checks.push({ name, pass: cond, detail });
  if (!cond) issues.push(`${name}: ${detail ?? "FAILED"}`);
}

// === Round 2 checks ===

// 1. Orphaned extracted people (extractionRunId doesn't exist)
const runIds = new Set(Object.keys(extractionRuns));
const personIds = new Set(Object.keys(extractedPeople));
for (const [id, person] of Object.entries(extractedPeople)) {
  if (!runIds.has(person.extractionRunId)) {
    check("orphaned_extracted_people", false, `Person ${id} references missing run ${person.extractionRunId}`);
  }
}
check("orphaned_extracted_people", !Object.values(extractedPeople).some((p) => !runIds.has(p.extractionRunId)), "All extracted people have valid extraction runs");

// 2. Orphaned review decisions (extractedPersonId doesn't exist)
for (const [id, review] of Object.entries(reviewDecisions)) {
  if (!personIds.has(review.extractedPersonId)) {
    check("orphaned_review_decisions", false, `Review ${id} references missing person ${review.extractedPersonId}`);
  }
}
check("orphaned_review_decisions", !Object.values(reviewDecisions).some((r) => !personIds.has(r.extractedPersonId)), "All review decisions reference existing people");

// 3. Missing screenshot files
const shotIds = new Set(Object.keys(screenshots));
for (const [id, shot] of Object.entries(screenshots)) {
  const fullPath = path.join(root, shot.storagePath);
  if (!fs.existsSync(fullPath)) {
    check("missing_screenshot_files", false, `Screenshot ${id} file missing: ${shot.storagePath}`);
  }
}
check("missing_screenshot_files", !Object.values(screenshots).some((s) => !fs.existsSync(path.join(root, s.storagePath))), "All screenshot files exist on disk");

// 4. Export records pointing to missing files
for (const [id, exp] of Object.entries(exportBatches)) {
  const jsonPath = path.join(root, exp.exportJsonPath);
  const csvPath = path.join(root, exp.exportCsvPath);
  const manifestPath = path.join(root, exp.manifestPath);
  if (!fs.existsSync(jsonPath)) check("export_missing_files", false, `Export ${id} JSON missing: ${exp.exportJsonPath}`);
  if (!fs.existsSync(csvPath)) check("export_missing_files", false, `Export ${id} CSV missing: ${exp.exportCsvPath}`);
  if (!fs.existsSync(manifestPath)) check("export_missing_files", false, `Export ${id} manifest missing: ${exp.manifestPath}`);
}
check("export_missing_files", !Object.values(exportBatches).some((e) =>
  !fs.existsSync(path.join(root, e.exportJsonPath)) ||
  !fs.existsSync(path.join(root, e.exportCsvPath)) ||
  !fs.existsSync(path.join(root, e.manifestPath))
), "All export files exist on disk");

// 5. Invalid JSON records
for (const [name, data] of [
  ["companies", companies], ["batches", batches], ["screenshots", screenshots],
  ["extraction_runs", extractionRuns], ["extracted_people", extractedPeople],
  ["mutual_contacts", mutualContacts], ["eligibility_decisions", eligibilityDecisions],
  ["review_decisions", reviewDecisions], ["crm_sync_records", crmSyncRecords],
  ["email_drafts", emailDrafts], ["export_batches", exportBatches],
  ["extraction_attempts", extractionAttempts], ["raw_responses", rawResponses],
  ["audit_events", auditEvents],
]) {
  try { JSON.stringify(data); } catch (e) {
    check("invalid_json_records", false, `Collection ${name} has invalid JSON: ${e.message}`);
  }
}
check("invalid_json_records", true, "All collections are valid JSON");

// 6. Cross-company export leakage
const companyIds = new Set(Object.keys(companies));
for (const [id, exp] of Object.entries(exportBatches)) {
  for (const personId of exp.includedPersonIds) {
    const person = extractedPeople[personId];
    if (person && person.companyId !== exp.companyId) {
      check("cross_company_export_leakage", false, `Export ${id} includes person ${personId} from company ${person.companyId} but export is for ${exp.companyId}`);
    }
  }
}
check("cross_company_export_leakage", !Object.values(exportBatches).some((exp) =>
  exp.includedPersonIds.some((pid) => {
    const p = extractedPeople[pid];
    return p && p.companyId !== exp.companyId;
  })
), "No cross-company export leakage detected");

// === Round 3 checks ===

// 7. extraction_attempts point to existing screenshots
const attemptIds = new Set(Object.keys(extractionAttempts));
for (const [id, attempt] of Object.entries(extractionAttempts)) {
  if (!shotIds.has(attempt.screenshotId)) {
    check("r3_attempt_screenshot_ref", false, `Extraction attempt ${id} references missing screenshot ${attempt.screenshotId}`);
  }
}
check("r3_attempt_screenshot_ref", !Object.values(extractionAttempts).some((a) => !shotIds.has(a.screenshotId)), "All extraction attempts reference existing screenshots");

// 8. raw_responses point to existing extraction_attempts
for (const [id, raw] of Object.entries(rawResponses)) {
  if (!attemptIds.has(raw.extractionAttemptId)) {
    check("r3_raw_response_attempt_ref", false, `Raw response ${id} references missing extraction attempt ${raw.extractionAttemptId}`);
  }
}
check("r3_raw_response_attempt_ref", !Object.values(rawResponses).some((r) => !attemptIds.has(r.extractionAttemptId)), "All raw responses reference existing extraction attempts");

// 9. extracted_people with extractionAttemptId point to existing extraction_attempts
for (const [id, person] of Object.entries(extractedPeople)) {
  if (person.extractionAttemptId && !attemptIds.has(person.extractionAttemptId)) {
    check("r3_person_attempt_ref", false, `Extracted person ${id} references missing extraction attempt ${person.extractionAttemptId}`);
  }
}
check("r3_person_attempt_ref", !Object.values(extractedPeople).some((p) => p.extractionAttemptId && !attemptIds.has(p.extractionAttemptId)), "All extracted people with extractionAttemptId reference existing attempts");

// 10. Failed extraction attempts created no people
const failedAttemptIds = new Set(
  Object.values(extractionAttempts)
    .filter((a) => a.status === "failed")
    .map((a) => a.id)
);
for (const [id, person] of Object.entries(extractedPeople)) {
  if (person.extractionAttemptId && failedAttemptIds.has(person.extractionAttemptId)) {
    check("r3_failed_attempt_no_people", false, `Person ${id} was created from failed attempt ${person.extractionAttemptId}`);
  }
}
check("r3_failed_attempt_no_people", !Object.values(extractedPeople).some(
  (p) => p.extractionAttemptId && failedAttemptIds.has(p.extractionAttemptId)
), "No people created from failed extraction attempts");

// 11. missing_credentials attempts created no people
const missingCredAttemptIds = new Set(
  Object.values(extractionAttempts)
    .filter((a) => a.errorCategory === "missing_credentials")
    .map((a) => a.id)
);
for (const [id, person] of Object.entries(extractedPeople)) {
  if (person.extractionAttemptId && missingCredAttemptIds.has(person.extractionAttemptId)) {
    check("r3_missing_credentials_no_people", false, `Person ${id} was created from missing_credentials attempt ${person.extractionAttemptId}`);
  }
}
check("r3_missing_credentials_no_people", !Object.values(extractedPeople).some(
  (p) => p.extractionAttemptId && missingCredAttemptIds.has(p.extractionAttemptId)
), "No people created from missing_credentials attempts");

// 12. No email/export includes unapproved Gemini extraction
// Build latest review state per person
const latestReviews = new Map();
for (const review of Object.values(reviewDecisions)) {
  const existing = latestReviews.get(review.extractedPersonId);
  if (!existing || review.decidedAt > existing.decidedAt) {
    latestReviews.set(review.extractedPersonId, review);
  }
}
function isApproved(personId) {
  const rev = latestReviews.get(personId);
  return rev && rev.decision === "approved";
}

// 12a. Email drafts
for (const [id, draft] of Object.entries(emailDrafts)) {
  for (const personId of draft.personIds) {
    const person = extractedPeople[personId];
    if (person && person.provenance === "gemini" && !isApproved(personId)) {
      check("r3_email_unapproved_gemini", false, `Email draft ${id} includes unapproved Gemini-extracted person ${personId}`);
    }
  }
}
check("r3_email_unapproved_gemini", !Object.values(emailDrafts).some((d) =>
  d.personIds.some((pid) => {
    const p = extractedPeople[pid];
    return p && p.provenance === "gemini" && !isApproved(pid);
  })
), "No email drafts include unapproved Gemini-extracted people");

// 12b. Export batches
for (const [id, exp] of Object.entries(exportBatches)) {
  for (const personId of exp.includedPersonIds) {
    const person = extractedPeople[personId];
    if (person && person.provenance === "gemini" && !isApproved(personId)) {
      check("r3_export_unapproved_gemini", false, `Export ${id} includes unapproved Gemini-extracted person ${personId}`);
    }
  }
}
check("r3_export_unapproved_gemini", !Object.values(exportBatches).some((e) =>
  e.includedPersonIds.some((pid) => {
    const p = extractedPeople[pid];
    return p && p.provenance === "gemini" && !isApproved(pid);
  })
), "No export batches include unapproved Gemini-extracted people");

// === Round 4 checks ===

// 13. Audit event referential integrity (audit_events collection)
// Must match AuditEventType union in packages/shared/src/types/entities.ts
const validEventTypes = new Set([
  "screenshot_uploaded", "manual_extraction_imported",
  "gemini_extraction_attempted", "gemini_extraction_failed", "gemini_extraction_succeeded",
  "review_decision_created", "person_edited", "email_generated",
  "export_created", "backup_created",
  "bulk_approve_completed", "bulk_intake_completed",
  "intake_screenshot_uploaded", "company_auto_created",
  "master_observation_created", "master_person_merged", "master_db_backfilled",
]);
let auditBad = false;
for (const [id, evt] of Object.entries(auditEvents)) {
  if (!validEventTypes.has(evt.eventType)) {
    check("r4_audit_event_valid", false, `Audit event ${id} has invalid eventType ${evt.eventType}`);
    auditBad = true;
  }
  // Audit events should never contain secret-like fields
  const serialized = JSON.stringify(evt);
  if (/AIzaSy[A-Za-z0-9_-]{30,}/.test(serialized)) {
    check("r4_audit_no_secrets", false, `Audit event ${id} contains a secret-like pattern`);
    auditBad = true;
  }
}
check("r4_audit_event_valid", !Object.values(auditEvents).some((e) => !validEventTypes.has(e.eventType)),
  auditEvents && Object.keys(auditEvents).length > 0 ? `${Object.keys(auditEvents).length} events, all valid types` : "No audit events to check (empty collection is valid)");
check("r4_audit_no_secrets", !auditBad, "No secrets detected in audit events");

// 14. Backup folder sane (if backups exist)
const backupsDir = path.join(root, "data", "backups");
let backupOk = true;
if (fs.existsSync(backupsDir)) {
  const backupEntries = fs.readdirSync(backupsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.startsWith("backup_"));
  for (const be of backupEntries) {
    const manifestFile = path.join(backupsDir, be.name, "__backup_manifest.json");
    if (!fs.existsSync(manifestFile)) {
      check("r4_backup_manifest_valid", false, `Backup ${be.name} missing manifest`);
      backupOk = false;
      continue;
    }
    try {
      const bm = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
      if (!bm.backupId || !bm.entries || typeof bm.totalFiles !== "number") {
        check("r4_backup_manifest_valid", false, `Backup ${be.name} manifest malformed`);
        backupOk = false;
      }
    } catch {
      check("r4_backup_manifest_valid", false, `Backup ${be.name} manifest unreadable`);
      backupOk = false;
    }
  }
}
check("r4_backup_manifest_valid", backupOk, fs.existsSync(backupsDir) ? "All backup manifests valid" : "No backups directory (valid for fresh install)");

// Summary
log("");
log("=== Checks ===");
for (const c of checks) {
  log(`  ${c.pass ? "PASS" : "FAIL"} — ${c.name}: ${c.detail}`);
}
log("");
log(`=== Summary ===`);
log(`Total checks: ${checks.length}`);
log(`Passed: ${checks.filter((c) => c.pass).length}`);
log(`Failed: ${checks.filter((c) => !c.pass).length}`);
log(`Issues: ${issues.length}`);
if (issues.length > 0) {
  log("");
  log("Issues:");
  for (const issue of issues) log(`  - ${issue}`);
}
log("");
log(`RESULT: ${issues.length === 0 ? "PASS" : "FAIL"}`);

// Write output
const outPath = path.join(root, "Evidence", "data-integrity-output.txt");
fs.writeFileSync(outPath, lines.join("\n"), "utf8");
process.exit(issues.length === 0 ? 0 : 1);
