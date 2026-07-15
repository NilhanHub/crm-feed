# Data Model

The CRM Feed database is the **single source of truth**. All entities below are persisted by the local API store. IDs are string ULIDs/UUIDs unless noted. Timestamps are ISO-8601 UTC strings.

## Entities

### Company
The target employer Nilhan is sourcing contacts for.
- `id: string`
- `name: string` (target company name)
- `website?: string`
- `notes?: string`
- `aliases?: string[]` (alternative names, used for matching in bulk intake)
- `normalizedName?: string` (canonical normalized name for matching)
- `autoCreated?: boolean` (true for companies auto-created by bulk intake)
- `inferenceConfidence?: number` (confidence score from company inference engine)
- `createdAt: string`
- `updatedAt: string`
- **Relationships:** has many `ScreenshotBatch`, has many `ExtractedPerson` (via batches/runs), has many `CrmSyncRecord`, has many `EmailDraft`.

### ScreenshotBatch
A grouped upload session for one company.
- `id: string`
- `companyId: string` (→ Company)
- `label?: string`
- `status: "open" | "extraction_pending" | "extraction_done" | "archived"`
- `createdAt: string`
- `updatedAt: string`
- **Relationships:** belongs to `Company`; has many `Screenshot`; has many `ExtractionRun`.

### Screenshot
A single uploaded image file, stored permanently.
- `id: string`
- `batchId: string` (→ ScreenshotBatch; `"__intake__"` for bulk intake screenshots before assignment)
- `originalFilename: string`
- `storedFilename: string` (name on disk under `data/uploads`)
- `storagePath: string` (absolute or repo-relative path)
- `mimeType: string`
- `sizeBytes: number`
- `sha256: string` (integrity hash)
- `intakeBatchId?: string` (→ IntakeBatch, when uploaded via bulk intake)
- `inferredCompanyId?: string` (→ Company, inferred company from bulk intake, or `"__unassigned__"` for unassigned)
- `inferenceConfidence?: number` (0-1, confidence of the company inference)
- `needsCompanyReview?: boolean` (true when company inference confidence is low)
- `uploadedAt: string`
- **Lifecycle:** permanent until explicit deletion (logged). Never silently removed.

### IntakeBatch (Round 5)
A batch of screenshots uploaded via the bulk intake endpoint.
- `id: string`
- `status: "processing" | "completed" | "partial" | "failed"` (partial = some assigned, some unassigned)
- `screenshotsReceived: number`
- `screenshotsAssigned: number` (high-confidence, assigned to companies)
- `companiesCreated: number`
- `companiesReused: number`
- `unassignedCount: number` (low-confidence, needs company review)
- `peopleExtracted: number`
- `note?: string` (warnings/errors)
- `createdAt: string`
- `completedAt?: string`
- **Lifecycle:** created at upload start, updated with final counts on completion.

### ExtractionRun
A single extraction attempt over a batch. Never contains fabricated people.
- `id: string`
- `batchId: string` (→ ScreenshotBatch)
- `status: "pending_extraction" | "pending_credentials" | "in_progress" | "completed" | "failed" | "review_ready"`
- `provider: "gemini" | "vision_ocr" | "document_ai" | "manual_attach" | "none"`
- `providerRunId?: string`
- `error?: string` (clear, useful message when failing)
- `payload?: ExtractionPayload` (attached structured JSON per `SCREENSHOT_EXTRACTION_SCHEMA.md`)
- `startedAt?: string`
- `completedAt?: string`
- `createdAt: string`
- `updatedAt: string`
- **Lifecycle:** created as `pending_extraction`/`pending_credentials`. When a real payload is attached, status becomes `review_ready` and derived `ExtractedPerson` rows are materialised. No people are invented.

### ExtractedPerson
A person derived from an extraction payload, linked back to source screenshots and extraction attempts.
- `id: string`
- `extractionRunId: string` (→ ExtractionRun)
- `extractionAttemptId?: string` (→ GeminiExtractionAttempt, if extracted by Gemini)
- `companyId: string` (→ Company, denormalised for query ease)
- `name: string`
- `headline?: string`
- `title?: string`
- `location?: string`
- `connectionDegree?: 1 | 2 | 3 | "unknown"`
- `currentRoles: { title: string; company: string; evidenceText?: string }[]`
- `pastRoles: { title: string; company: string; evidenceText?: string }[]`
- `currentlyAtTargetCompany: boolean`
- `sourceScreenshotIds: string[]` (→ Screenshot)
- `confidence: number` (0..1, provider-reported or 1.0 for manual attach)
- `fieldConfidence?: { name?: number; title?: number; location?: number; currentRoles?: number; mutualContacts?: number }`
- `provenance: "gemini" | "manual_attach" | "vision_ocr" | "document_ai"`
- `createdAt: string`
- **Relationships:** has many `MutualContact`; has one `EligibilityDecision`; has one `ReviewDecision` (optional).

### GeminiExtractionAttempt
A single Gemini extraction attempt for one screenshot. Multiple attempts per screenshot are retained for retry history.
- `id: string`
- `screenshotId: string` (→ Screenshot)
- `extractionRunId: string` (→ ExtractionRun)
- `batchId: string` (→ ScreenshotBatch, denormalised)
- `companyId: string` (→ Company, denormalised)
- `status: "pending_credentials" | "pending_extraction" | "running" | "succeeded" | "failed" | "retrying" | "needs_manual_review"`
- `errorCategory?: "missing_credentials" | "model_request_failed" | "model_timeout" | "malformed_json" | "schema_validation_failed" | "empty_people" | "partial_extraction" | "low_confidence" | "unknown"`
- `errorMessage?: string`
- `retryCount: number` (0 for first attempt, incremented on retry)
- `modelUsed?: string` (e.g. "gemini-2.0-flash")
- `promptVersion?: string`
- `extractionSchemaVersion?: string`
- `rulesVersion?: string`
- `appCommit?: string`
- `startedAt?: string`
- `completedAt?: string`
- `createdAt: string`
- `updatedAt: string`
- **Lifecycle:** Created as `pending_extraction` or `pending_credentials`. Transitions to `running` when Gemini call starts. On success → `succeeded`. On failure → `failed` with error category. On retry → `retrying` then `running`. On partial/low-confidence but schema-valid → `needs_manual_review`.
- **Retry:** Each retry creates a new attempt record linked to the same screenshot, with `retryCount` incremented. Previous failure history is preserved.

### RawResponse
Stores the raw model response text for audit. Never contains secrets.
- `id: string`
- `extractionAttemptId: string` (→ GeminiExtractionAttempt)
- `screenshotId: string` (→ Screenshot)
- `provider: string` (e.g. "gemini")
- `rawText: string` (the raw JSON text returned by the model)
- `responseSize: number` (bytes)
- `storedAt: string`
- **Safety:** No secrets are stored. Only the model's response text. Large responses are truncated to a safe limit with a truncation marker.

### MutualContact
A mutual contact visible on a person's LinkedIn screenshot.
- `id: string`
- `extractedPersonId: string` (→ ExtractedPerson)
- `name: string` (named mutual only; `"__vague_count__"` for vague mutual count records)
- `headline?: string`
- `vagueCount?: number` (e.g. "2 other mutual connections")
- `excludedFromEmail: boolean` (true for vague counts; never emailed)
- `sourceScreenshotId?: string` (→ Screenshot — the source screenshot where this mutual was observed)
- **Rules:** Only **named** mutuals are email-eligible. Vague counts are recorded for audit but always `excludedFromEmail = true`.
- **Master DB foundation:** `sourceScreenshotId` links mutual contacts back to the original screenshot for provenance.

### EligibilityDecision
Deterministic decision produced by the rules engine (real code, not AI).
- `id: string`
- `extractedPersonId: string` (→ ExtractedPerson)
- `eligible: boolean`
- `reasons: string[]` (e.g. "past-only", "no named mutual", "currently at target")
- `computedAt: string`
- **Rules:** see `ELIGIBILITY_RULES.md`.

### ReviewDecision
Nilhan's human approval/rejection of a person. Multiple decisions per person are retained as **review history**; only the **latest** is authoritative.
- `id: string`
- `extractedPersonId: string` (→ ExtractedPerson)
- `decision: "approved" | "rejected" | "needs_review"`
- `note?: string`
- `reviewedBy: string` (always "Nilhan" for now — default local user, no auth)
- `decidedAt: string` (ISO-8601 UTC)

### CurrentReviewState (projection, not a separate table)
The **latest** review decision per ExtractedPerson, computed deterministically by the `projectLatestReviewState` function in `packages/shared`.
- `extractedPersonId: string`
- `latestDecision: "approved" | "rejected" | "needs_review"`
- `latestNote?: string`
- `latestReviewedBy: string`
- `latestDecidedAt: string`
- `historyCount: number`
- **Semantics:** If a person is approved then rejected, the latest rejection wins. If rejected then approved, the latest approval wins. Ties in `decidedAt` are broken by record order (last-written wins) deterministically.
- **Usage:** Email and export logic use only `CurrentReviewState.latestDecision === "approved"` to include a person.

### ReviewDecisionHistory
All `ReviewDecision` rows for a given `ExtractedPerson`, ordered by `decidedAt` ascending. Used for audit and the review history endpoint.

### ExportBatch
A durable record of a single export operation for a company.
- `id: string` (export ID, e.g. `exp_<uuid>`)
- `companyId: string` (→ Company)
- `companyName: string`
- `includedPersonIds: string[]` (approved, currently-at-target, named-mutual people)
- `exportJsonPath: string` (relative path under `data/exports`)
- `exportCsvPath: string`
- `manifestPath: string`
- `recordCount: number`
- `rulesVersion: string`
- `appVersion?: string`
- `status: "exported"` (never "synced" without a live CRM API)
- `generatedAt: string`
- **Lifecycle:** created on export, never mutated. Re-exports create new ExportBatch rows. Idempotency is on `(companyId, extractedPersonId)` within CrmSyncRecord, not on ExportBatch.

### ExportManifest
A manifest file written alongside each export, containing metadata for traceability. (Round 4 hardened with integrity and source-basis fields.)
- `exportId: string`
- `paths: { json: string; csv: string }`
- `recordCount: number`
- `rulesVersion: string`
- `appVersion?: string`
- `generatedAt: string`
- `provenance: [{ extractedPersonId, sourceScreenshotIds, sha256Hashes }]`
- `liveCrmSync: false` (boolean; always false until a real, authenticated CRM API call succeeds)
- `companyId: string` (→ Company)
- `approvedPersonIds: string[]` (approved, currently-at-target, named-mutual people included)
- `sourceReviewStateBasis: "latest"` (documents that export is based on latest review state only)
- `extractionSchemaVersion: string`
- `fileHashes: { json: { sha256: string; sizeBytes: number }; csv: { sha256: string; sizeBytes: number } }`

### CrmSyncRecord
A CRM-ready record produced only from people whose latest review state is approved AND who are currently at the target company AND have named mutuals.
- `id: string`
- `companyId: string` (→ Company)
- `extractedPersonId: string` (→ ExtractedPerson)
- `reviewDecisionId: string` (→ latest ReviewDecision)
- `exportBatchId?: string` (→ ExportBatch)
- `status: "pending_export" | "exported" | "synced" | "failed" | "not_implemented"`
- `exportPath?: string` (path under `data/exports` when exported)
- `syncedAt?: string`
- `error?: string`
- `createdAt: string`
- **Policy:** With no live CRM API, status is `not_implemented` or `exported` (real export file), never faked `synced`. See `CRM_WRITE_POLICY.md`.
- **Company-scoping:** Only people with `ExtractedPerson.companyId === selectedCompanyId` are ever included. No cross-company leakage.

### EmailDraft
A plain-text email generated from people whose latest review state is approved, currently at target company, with named mutuals — company-scoped.
- `id: string`
- `companyId: string` (→ Company)
- `body: string` (plain text, no Markdown)
- `personIds: string[]` (approved latest-state ExtractedPerson ids used)
- `rulesVersion: string`
- `createdAt: string`
- **Rules:** see email format in `MASTER_SPEC.md` §5 and the formatter in `packages/shared`.

### AuditEvent (Round 4, extended Round 5)
An append-only audit event. Events are never mutated or deleted — audit is write-only history. Stored in the `audit_events.json` collection (the 15th collection).
- `id: string`
- `eventType: string` — one of 15 types:
   1. `screenshot_uploaded`
   2. `manual_extraction_imported`
   3. `gemini_extraction_attempted`
   4. `gemini_extraction_failed`
   5. `gemini_extraction_succeeded`
   6. `review_decision_created`
   7. `person_edited`
   8. `email_generated`
   9. `export_created`
   10. `backup_created`
   11. `bulk_approve_completed` (Round 4.5)
   12. `bulk_intake_completed` (Round 5)
   13. `intake_screenshot_uploaded` (Round 5)
   14. `company_auto_created` (Round 5)
   15. `integrity_check_run`
- `companyId?: string` (→ Company, when scoped to a company)
- `batchId?: string` (→ ScreenshotBatch)
- `personId?: string` (→ ExtractedPerson)
- `screenshotId?: string` (→ Screenshot)
- `attemptId?: string` (→ GeminiExtractionAttempt)
- `exportId?: string` (→ ExportBatch)
- `emailDraftId?: string` (→ EmailDraft)
- `backupId?: string` (→ BackupManifest)
- `actor: string` (e.g. "Nilhan" / "system")
- `detail?: string` (free-text context, never contains secrets)
- `createdAt: string`
- **Lifecycle:** append-only. No update or delete path. Exposed read-only via `GET /api/audit`.

### BackupManifest (Round 4)
A manifest describing the contents of a single local backup, written to `data/backups/<id>/__backup_manifest.json`.
- `backupId: string` (timestamped folder name)
- `createdAt: string`
- `appVersion: string`
- `rulesVersion: string`
- `entries: { path: string; sizeBytes: number; sha256: string }[]` (one per backed-up file)
- `totalFiles: number`
- `totalBytes: number`
- `note?: string`
- **Lifecycle:** written once at backup creation. Verified by `scripts/verify-backup.mjs`, which recomputes every `sha256` against the stored file and reports PASS/FAIL.

## Collections (JSON store)
The local JSON store holds 15 collections:
1. `companies.json`
2. `intake_batches.json` (added in Round 5)
3. `batches.json`
4. `screenshots.json`
5. `extractionRuns.json`
6. `extractedPeople.json`
7. `mutualContacts.json`
8. `eligibilityDecisions.json`
9. `reviewDecisions.json`
10. `exportBatches.json`
11. `crmSyncRecords.json`
12. `emailDrafts.json`
13. `geminiExtractionAttempts.json`
14. `rawResponses.json`
15. `audit_events.json`

## Company-scoped selection
When generating email or export for a company, the selection pipeline:
1. Filters `ExtractedPerson` to `companyId === selectedCompanyId` (no cross-company leakage).
2. Computes `CurrentReviewState` per person (latest decision only).
3. Keeps only `latestDecision === "approved"`.
4. Keeps only `currentlyAtTargetCompany === true` (not past-only).
5. Keeps only people with ≥1 named mutual contact (vague counts excluded).
6. Deduplicates by normalised name + target company.
7. Ranks by role priority score.
8. Caps to max 10 people, max 7 named mutuals each.

## Duplicate person handling
- Duplicate candidates are detected by normalised full name + normalised current company (+ normalised title/headline where available).
- Duplicates are **flagged for review**, not silently deleted. The reviewer decides which to keep.
- Source screenshot IDs are preserved on all duplicate candidates.
- The `dedupePeople` function in `packages/shared` keeps the higher-confidence record but reports all duplicates.

## Screenshot provenance
- Every `ExtractedPerson` stores `sourceScreenshotIds[]` linking back to the original `Screenshot` records.
- Screenshot records store `sha256`, `originalFilename`, `storagePath`, `mimeType`, `sizeBytes`.
- Provenance is preserved in export manifests and CrmSyncRecords for traceability.
- Provenance is **never** exposed in Paul-facing email drafts.

## Status value summary
- ScreenshotBatch: `open | extraction_pending | extraction_done | archived`
- ExtractionRun: `pending_extraction | pending_credentials | in_progress | completed | failed | review_ready`
- ReviewDecision: `approved | rejected | needs_review`
- CrmSyncRecord: `pending_export | exported | synced | failed | not_implemented`

## Lifecycle invariants
- No `ExtractedPerson` exists without a real `ExtractionRun` payload or manual attach.
- No `CrmSyncRecord` exists without a latest-approved `ReviewDecision` and currently-at-target + named-mutual eligibility.
- No `EmailDraft` includes a latest-rejected/needs-review person, a past-only person, or a person with no named mutuals.
- No `EmailDraft` or export includes people from a company other than the selected one.
- Screenshot files are permanent; provenance (`sourceScreenshotIds`) is always retained internally.
- Export files are durable; re-exports create new `ExportBatch` rows, never mutate existing ones.
