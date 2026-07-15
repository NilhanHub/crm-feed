# CRM Feed Changelog

## Round 5 (2026-07-05): Master DB Materialization + Integrity Stabilization
### Added
- **Master DB materialized** via backfill: 31 person observations, 30 master people, 39 employment observations, 9 named mutual observations, 30 vague mutual observations.
- **Backfill safety guard**: Records with non-existent screenshot IDs are filtered out, preventing orphan observations.
- **Config path stability**: API resolves repo root from script location + package.json walks, supports `CRM_FEED_APP_ROOT` override. Works from repo root or `apps/api`.
- **dotenv loading**: `.env` auto-loaded at startup. Users copy `.env.example` to `.env` at repo root.
- **Empty export guard**: Export creation now rejects when no approved eligible people exist.
- **Round 5 acceptance doc** (`docs/ROUND_5_ACCEPTANCE.md`).
### Fixed
- **Data integrity check**: `validEventTypes` set updated to match `AuditEventType` union. All 16 checks PASS (previously 3 failures, 2 false + 1 real).
- **Lint**: 0 errors, 28 warnings (down from 2 errors, 35 warnings). Fixed empty catch blocks, unused variables, import cleanup.
### Changed
- Backfill drops invalid screenshot references (51 records with artificial IDs like `screenshot_1` filtered out).
- Export creation route returns 400 with `no_approved_people` if no candidates.
- `scripts/data-integrity-check.mjs` validEventTypes synced with TypeScript source.
### Preserved
- All existing business rules (company scoping, past-only exclusion, vague mutual exclusion, human approval required, latest review wins).
- All existing routes and UI unchanged.
- All existing data preserved (no migrations required).
- Master DB remains read/analysis-only; does not affect review approval, eligibility, email drafts, or exports.

## Round 4 (2026-07-03): Production Readiness
### Added
- **Local backup script** (`scripts/backup-data.mjs`) with timestamped folders + SHA-256 manifest.
- **Backup verification script** (`scripts/verify-backup.mjs`).
- **Audit logging system**: 10 event types, append-only writer (`apps/api/src/audit/writer.ts`), audit API (`/api/audit`), frontend audit panel.
- **Comprehensive health diagnostics endpoint** (`GET /api/health`): app version, git commit, rules/schema/prompt versions, storage writability, Gemini status, DB counts.
- **Export verification script** (`scripts/verify-exports.mjs`) — verifies company scoping, latest-approved-only, no vague-mutual-only, file hashes.
- **Export manifest hardening**: `liveCrmSync=false`, `companyId`, `approvedPersonIds`, `fileHashes`, `sourceReviewStateBasis`.
- **Frontend diagnostics panel** (version/mode/storage/Gemini status).
- **Config centralization** (`apps/api/src/config.ts`): `GEMINI_CONFIG`, `NODE_ENV`, `PATHS.backups`, safe storage helpers.
- **Data integrity checker extended** with audit + backup checks (16 total).
- **Documentation**: `BACKUP_AND_RESTORE.md`, `CRM_SYNC_BOUNDARY.md`, `ADK_ORCHESTRATION_BOUNDARY.md`, `DEPLOYMENT_READINESS_CHECKLIST.md`.
- **Tests**: 8 new Round 4 production tests (config/health, audit, export manifest).
- **Test flake fix**: `atomicStore.clear()` method, vitest `singleFork` config.
### Changed
- **Rules version bumped 3.0.0 → 4.0.0.**
- Health endpoint expanded from 6 fields to comprehensive diagnostics.
- Export manifest format enhanced with integrity fields.
### Intentionally NOT Built
- No live cloud deployment.
- No live CRM sync.
- No ADK agent.
- No live Gemini extraction (key not set).
### Known Blockers
- `GEMINI_API_KEY` not set — live Gemini path untested (missing-key path proven).
### Round 5 Suggestions
- Provision `GEMINI_API_KEY` and test live extraction.
- Real browser UI screenshots via Playwright.
- Production deployment (Firebase/Hostinger under `nilhan.dev@gmail.com`).
- CRM sync adapter implementation.

## Round 2 — Review Workflow & CRM Data Engine
### Added
- **Latest review state projection** (`packages/shared/src/review/projection.ts`): only the latest `ReviewDecision` per `ExtractedPerson` is authoritative. Approve→reject → excluded; reject→approve → included.
- **Duplicate detection helpers** (`packages/shared/src/review/dedupe.ts`): normalised name + company + title matching; flags duplicates for review without deleting.
- **Company-scoped selection helper** (`packages/shared/src/review/selection.ts`): selects only people currently at the selected company, with named mutuals, latest-approved, not past-only, max 10 people, max 7 mutuals.
- **Review state types**: `CurrentReviewState`, `ReviewDecisionHistory`, `ExportBatch`, `ExportManifest`.
- **Rules versioning**: `RULES_VERSION = "2.0.0"` recorded in exports and email drafts.
- **Review queue endpoints**: list by company, list by batch, person details with provenance, submit/update decision, review history.
- **Edit-before-approval**: `PATCH /api/reviews/person/:personId` — edit name, title, location, current role, mutual contacts without deleting provenance.
- **Status summary endpoint**: `GET /api/status/company/:companyId` — counts for batches, screenshots, runs, people, eligible, approved, rejected, duplicates, export-ready.
- **Durable export records**: `ExportBatch` stored in `export_batches` collection with export ID, company, person IDs, paths, manifest, rules version, status.
- **CSV export**: includes company, name, title, location, current role, named mutuals, source screenshot IDs, review status, export date.
- **JSON export**: full structured data with provenance, review metadata, ranking/eligibility.
- **Export manifest**: export ID, paths, counts, rules version, app version/commit, provenance.
- **Review console UI**: status dashboard, review cards with full details, approved/rejected/eligible filters, duplicate warnings, edit form, email preview, export panel.
- **Strong empty/error states**: no company, no screenshots, no payload, invalid JSON, no eligible, no approved, export blocked.
- **Dev seed/reset script**: `scripts/dev-seed-reset.ps1` — local dev/test only, never automatic.
- **Data integrity check script**: `scripts/data-integrity-check.mjs` — checks orphans, missing files, invalid JSON, cross-company leakage.
- **Round 3 prep docs**: `ROUND_3_GEMINI_EXTRACTION_PLAN.md`, `ENVIRONMENT.md`.
- **27 new unit tests** (57 total): review projection (10), company selection (9), dedupe (8).

### Fixed (from Round 1)
- **Export company-scoping bug**: exports now filter by `companyId` — no cross-company leakage.
- **Latest review state bug**: email and export now use `projectLatestReviewStates()` — only latest decision is authoritative.
- **Evidence mismatch**: final git status regenerated after commit/amend.
- **Evidence ZIP hygiene**: explicit exclusion of node_modules/dist/secrets.

### Changed
- `ReviewDecisionValue` changed from `"approved" | "rejected" | "deferred"` to `"approved" | "rejected" | "needs_review"`.
- `MASTER_SPEC.md` updated with real review workflow, latest review semantics, company-scoped email/export, CRM-ready export boundary.
- `DATA_MODEL.md` updated with CurrentReviewState, ExportBatch, ExportManifest, company-scoped selection, dedupe, provenance.
- `ELIGIBILITY_RULES.md` updated with latest review state rule, no Markdown bold, no source wording.
- `EVIDENCE_REQUIREMENTS.md` updated with Round 2 evidence requirements and ZIP exclusion rules.

## Round 1 — Repo Spine & Local Persistence
### Added
- Monorepo (npm workspaces): `apps/web`, `apps/api`, `packages/shared`.
- 9 governance docs: MASTER_SPEC, IDENTITY_LOCK, DATA_MODEL, SCREENSHOT_EXTRACTION_SCHEMA, ELIGIBILITY_RULES, CRM_WRITE_POLICY, AGENT_WORKFLOW, EVIDENCE_REQUIREMENTS, ROUND_1_ACCEPTANCE.
- Shared package: types, Zod schemas, deterministic eligibility, ranking, email formatter, 30 tests.
- API: Express + TypeScript with real atomic JSON persistence, screenshot upload, extraction run, payload attach, reviews, email, export.
- Web: React + Vite + TypeScript premium UI with company/batch/upload/extraction/review/email panels.
- All quality gates passing (typecheck, test, build, lint).

### Known Issues (Round 1)
- Export route exported approved people from ALL companies, not just selected company (fixed in Round 2).
- Email/export used ALL approved reviews, not latest per person (fixed in Round 2).
- Evidence final_git_status had stale commit hash after amend (fixed in Round 2).

## Round 3 — Gemini Extraction
### Added
- **Gemini extraction service** (`apps/api/src/extraction/gemini.ts`): real multimodal structured extraction using `@google/genai` SDK. Sends screenshot image bytes to Gemini with `responseMimeType: "application/json"` and a `responseJsonSchema` for structured output. Supports configurable model, timeout, and max retries via env vars.
- **Prompt template** (`apps/api/src/extraction/prompt.ts`): versioned prompt (`GEMINI_PROMPT_VERSION = "1.0.0"`) that instructs Gemini to extract only visible text, never guess, separate current from past roles, capture named mutuals only, preserve uncertainty, and never decide eligibility.
- **Gemini-specific Zod schema** (`packages/shared/src/schema/extraction.ts`): `GeminiExtractionPayloadSchema` — stricter subset of `ExtractionPayloadSchema` requiring `provider: "gemini"`, with `safeParseGeminiExtraction()` validation.
- **Error classification** (`packages/shared/src/extraction/errors.ts`): 9 error categories (`missing_credentials`, `model_request_failed`, `model_timeout`, `malformed_json`, `schema_validation_failed`, `empty_people`, `partial_extraction`, `low_confidence`, `unknown`), each with retryable flag and user-friendly message.
- **Confidence scoring helpers** (`packages/shared/src/extraction/confidence.ts`): `classifyConfidence()`, `classifyFieldConfidence()`, `isLowConfidencePerson()`, `hasAnyLowConfidenceField()` with high/medium/low/unknown classes.
- **Gemini-to-reviewable normalizer** (`packages/shared/src/extraction/normalizer.ts`): `normalizeGeminiExtraction()` and `normalizePerson()` — normalises validated Gemini output into reviewable `NormalizedPerson` records with provenance, confidence class, field confidence, low-confidence flags.
- **Extraction endpoints** (`apps/api/src/routes/extraction.ts`):
  - `POST /api/extraction/extract/:screenshotId` — extract a single screenshot with Gemini
  - `POST /api/extraction/extract-batch/:batchId` — extract all screenshots in a batch
  - `POST /api/extraction/retry/:screenshotId` — retry a failed extraction
  - `GET /api/extraction/attempts/screenshot/:screenshotId` — attempt history for a screenshot
  - `GET /api/extraction/attempts/batch/:batchId` — attempt history for a batch
- **Raw response audit storage**: Gemini raw response text stored as `RawResponse` records linked to extraction attempt and screenshot for audit.
- **Gemini extraction statuses**: `pending_credentials`, `pending_extraction`, `running`, `succeeded`, `failed`, `retrying`, `needs_manual_review`.
- **Extraction controls in web UI**: per-screenshot Extract/Retry buttons, batch Extract All and Force Re-extract, attempt history expandable rows showing status, error category, model used, retry count, timestamps, prompt/schema versions.
- **Confidence display in review cards**: percentage badge with color coding (>=80% green, >=50% amber, <50% red), expandable field-level confidence breakdown.
- **Provenance display**: Gemini vs Manual label on review cards, extraction attempt ID shown when available.
- **Status dashboard metrics**: extraction attempts count, Gemini-extracted people count.
- **Manual JSON import preserved**: UI panel for attaching manual payload remains separate from Gemini extraction, clearly labelled as fallback.
- **Frontend error/empty states**: no screenshots uploaded state in extraction panel, no extraction attempts state, credential-missing state, failure states with expandable error details.
- **Health endpoint**: `GET /api/health` returns extraction provider availability and configured model.
- **Data integrity checker extended** (`scripts/data-integrity-check.mjs`): checks GeminiExtractionAttempt and RawResponse integrity.
- **No-secret scanner** (`scripts/verify-evidence.mjs`): scans Evidence folder for secrets.
- **Dev seed/reset updated** (`scripts/dev-seed-reset.ps1`): resets GeminiExtractionAttempt and RawResponse collections.
- **Versioning** (`packages/shared/src/rules/version.ts`): `RULES_VERSION = "3.0.0"`, `EXTRACTION_SCHEMA_VERSION = "3.0.0"`, `GEMINI_PROMPT_VERSION = "1.0.0"`.
- **Round 3 smoke test** (`scripts/round-3-smoke-test.ps1`): tests missing credentials, manual payload import, review queue, no-bypass review, approve-then-email/export, company scoping, attempt history.
- **Round 3 acceptance doc**: `docs/ROUND_3_ACCEPTANCE.md` — 62 acceptance criteria across 10 phases.

### Changed
- `RULES_VERSION` from `2.0.0` to `3.0.0` with Round 3 description.
- `ExtractedPerson` entity gains `extractionAttemptId`, `fieldConfidence`, `provenance` fields.
- `DATA_MODEL.md` updated with `GeminiExtractionAttempt` and `RawResponse` entities.
- `MASTER_SPEC.md` updated with Gemini extraction flow (5a) and manual JSON import (5b).
- `ENVIRONMENT.md` updated with GEMINI_API_KEY, GEMINI_MODEL, GEMINI_TIMEOUT_MS, GEMINI_MAX_RETRIES.
- `EVIDENCE_REQUIREMENTS.md` updated with Round 3 evidence rules.
- `.env.example` updated with Gemini environment variables.

### Intentionally Not Built
- **No Google Cloud Vision / Document AI OCR backup.** The optional backup was deferred. Gemini multimodal alone is sufficient for LinkedIn screenshot extraction. Vision/Document AI can be added in a later round if needed.
- **No ADK agents for extraction.** Gemini extraction logic lives in the Express API service layer, not in ADK agents. ADK orchestration remains a Round 4 goal.
- **No automatic retry scheduling.** Retries are user-triggered via the retry endpoint / UI button, not automatic. Transient failures require manual retry.
- **No email sending.** Still draft-only.
- **No live CRM sync.** Export contract (JSON/CSV/manifest) is still the only write path.
- **No LinkedIn scraping or browser automation** — ever.

### Known Issues (Round 3)
- Gemini extraction requires `GEMINI_API_KEY` to be set. Without it, extraction fails to `missing_credentials` — no people are invented, which is correct behavior by design.
- Gemini structured output may occasionally omit low-visibility fields (e.g. location on a cropped screenshot). These appear as `null` with lowered per-field confidence.
- Per-screenshot extraction is fast (2–5s), but batch extraction of many screenshots is sequential, not parallel. Batch improvements deferred to a future round.
- Attempt history endpoint paginates client-side only. Large attempt histories may load slowly on the wire.

### Round 4 Plan (next)
Production hardening, ADK orchestration, and cloud deployment under `nilhan.dev@gmail.com`. See `docs/ROUND_4_PRODUCTION_GOOGLE_ADK_PLAN.md`.

## Round 5 (2026-07-04): Bulk Screenshot Intake + Company Auto-Assignment
### Added
- **Bulk intake endpoint** (`POST /api/intake/bulk-screenshots`): accept up to 50 files, store screenshots, run Gemini extraction, infer company, auto-create/reuse companies, assign screenshots/people, return summary.
- **Intake batch listing** (`GET /api/intake/batches`).
- **Unassigned screenshots endpoint** (`GET /api/intake/unassigned`).
- **IntakeBatch entity**: status, counts, timestamps.
- **Company entity extended**: `normalizedName`, `aliases`, `autoCreated`, `inferenceConfidence`.
- **Screenshot entity extended**: `intakeBatchId`, `inferredCompanyId`, `inferenceConfidence`, `needsCompanyReview`.
- **MutualContact entity extended**: `sourceScreenshotId`.
- **AuditEventType extended**: `bulk_intake_completed`, `intake_screenshot_uploaded`, `company_auto_created`.
- **CompanyCandidateSchema + ScreenshotCompanyInferenceSchema** in extraction schema (optional/backward-compatible).
- **Deterministic company inference engine** (`packages/shared/src/rules/companyInference.ts`): weighted scoring with current-role preference, high-confidence threshold, runner-up guard, unassigned fallback.
- **`findMatchingCompany()`**: match by normalized name and aliases.
- **Frontend BulkIntakePanel**: multi-file upload, summary dashboard (received/assigned/companies/people), assigned/unassigned sections, "Upload more" flow.
- **Sidebar bulk intake toggle button**: opens/closes bulk intake panel.
- **API client methods**: `uploadBulkScreenshots()`, `listIntakeBatches()`, `getUnassignedScreenshots()`.
- **12 company inference unit tests**: empty candidates, high confidence, low confidence, mixed companies, no current mentions, weighted scoring, profile mention, ad downweighting, multiple roles, alias matching, no-match null.
- **5 API integration tests**: empty upload, file storage + summary, unsupported file types, batch listing, unassigned query.
- **Evidence files**: all Phase 1–22 evidence including step closure log, contract docs, source proofs, invariant proof, negative evidence, quality gate outputs, claim-to-evidence matrix, traceability check, stale value sweep, final truth report, ZIP, artifact lock.

### Changed
- `DATA_MODEL.md` updated with IntakeBatch, Screenshot fields, Company fields, MutualContact.sourceScreenshotId, collections list updated (15 collections).
- `MASTER_SPEC.md` updated with Round 5 bulk intake workflow, extraction schema extension, Master Relationship Database foundation.
- `SCREENSHOT_EXTRACTION_SCHEMA.md` updated with CompanyCandidateSchema and ScreenshotCompanyInferenceSchema.
- `packages/shared/src/index.ts` exports companyInference functions.

### Intentionally Not Built
- No identity resolution / master person merge across companies.
- No cross-company person history view.
- No graph database or relationship visualization.
- No automated CRM sync.
- No auto-approval of people from bulk intake.
- No email sending.
- No LinkedIn scraping.

### Known Issues
- Browser-level UI smoke testing was not performed (no Playwright).
- Company inference is conservative: mixed-company screenshots go to needs review rather than splitting people.
- Vague mutual counts from bulk intake are treated identically to existing flow (excluded from email).
- The Master Relationship Database is a soft foundation, not a full identity-resolution graph.
