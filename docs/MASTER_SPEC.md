# CRM Feed — Master Specification

## 1. App Name
**CRM Feed**

## 2. Purpose
Convert **manually uploaded LinkedIn screenshots** into reviewed, CRM-ready company, contact, and route data, and produce clean email drafts for Paul that never reveal the screenshot/OCR/extraction source.

The app is an intake and review pipeline. Screenshots are uploaded by the user; the app persists them permanently, records extraction runs, applies deterministic eligibility and ranking rules, surfaces a human review screen, and only after explicit approval produces CRM-ready records and email drafts.

## 3. Primary User
**Nilhan** — the only operator of this app. Nilhan uploads screenshots, reviews extracted people, approves/rejects them, and triggers exports and email drafts.

## 4. Output User
**Paul** — receives clean email drafts introducing reachable contacts at a target company. Paul must never see screenshot, OCR, extraction, or analysis wording in the final email.

## 5. Core Workflow
1. Nilhan creates/selects a **Company** (the target employer).
2. Nilhan creates a **ScreenshotBatch** for that company.
3. Nilhan uploads one or more **Screenshots** into the batch. Files are stored permanently under `data/uploads`.
4. An **ExtractionRun** is created for the batch. Extraction can proceed via two paths:
   - **Gemini extraction (Round 3+):** If `GEMINI_API_KEY` is configured, the app sends screenshot image bytes to Google Gemini with a structured output prompt. The raw Gemini response is stored internally. The structured output is validated against the Zod schema. On success, extracted people are materialised for review. On failure (missing credentials, malformed JSON, schema validation failure, timeout, partial extraction, low confidence), the attempt is recorded with a clear error category and no people are invented.
   - **Manual JSON import (fallback):** A developer/Nilhan can attach a real structured extraction JSON payload (per `SCREENSHOT_EXTRACTION_SCHEMA.md`) for review via the manual payload attach endpoint or UI panel. This path remains available when Gemini credentials are missing or extraction fails.
5. Extracted people become **ExtractedPerson** rows linked to the run, with **MutualContact** entries (named mutuals only; vague counts are recorded but flagged `excludedFromEmail`). Each person has a **confidence** score (0..1) from the extraction provider. The reviewer may edit extracted fields before approval (name, title, location, current role, mutual contacts) without deleting raw extraction provenance.
6. The deterministic **EligibilityDecision** engine evaluates each person (currently at company, named mutual present, etc.) per `ELIGIBILITY_RULES.md`. Gemini extraction **cannot bypass** eligibility rules or review approval.
7. The **Ranking** function scores target relevance (CEO/COO/CTO/IT/Cyber/etc. prioritised; HR/Marketing/Talent de-prioritised).
8. Nilhan reviews on the **Review console** and submits **ReviewDecision** rows (approve/reject/needs-review). Multiple decisions per person are retained as **review history**, but only the **latest decision** is authoritative for email/export eligibility.
9. Only people whose **latest review state is approved** AND who are currently at the target company AND have at least one named mutual become CRM-ready candidates. Email and export are **strictly company-scoped** — no cross-company leakage.
10. With no live CRM API, the app produces a real **CRM-ready export** (deterministic JSON + CSV + manifest under `data/exports`) — this is the current integration boundary. The export never claims `synced` status. `CrmSyncRecord.status` is `exported`.
11. Approved people feed the **EmailDraft** formatter, which emits plain text only.

### 5a. Gemini Extraction Flow
- Screenshot image bytes are read from `data/uploads` and sent to Gemini with `responseMimeType: "application/json"` and a structured output prompt.
- The raw Gemini response text is stored in a `RawResponse` record linked to the extraction attempt and screenshot.
- The structured output is validated with `safeParseExtractionPayload()`. Invalid output is rejected — no people are created.
- Valid output is normalised into `ExtractedPerson` + `MutualContact` + `EligibilityDecision` rows.
- Each extraction attempt is recorded with: status, error category, retry count, timestamps, confidence.
- Failed extractions can be retried. Retry count is incremented. Previous failure history is preserved.
- Extraction statuses: `pending_credentials`, `pending_extraction`, `running`, `succeeded`, `failed`, `retrying`, `needs_manual_review`.
- If `GEMINI_API_KEY` is missing, extraction fails clearly with `missing_credentials` error — no fake extraction, no invented people.

### 5b. Manual JSON Import (preserved)
- The manual payload attach endpoint (`POST /api/extraction-runs/:id/payload`) remains available.
- This path is clearly separate from Gemini extraction in the UI.
- Manual imports have `confidence = 1.0` and `provider = "manual_attach"`.

## 6. Non-Goals (for now)
- No LinkedIn scraping, browser automation, or automated LinkedIn access of any kind.
- No fake, mock, simulated, placeholder, dry-run, or pretend extraction results.
- No live CRM API sync yet. If no CRM credentials/endpoints exist, the app fails clearly and produces a CRM-ready export (JSON/CSV/manifest) — it never pretends success.
- No ADK agents implemented yet. ADK is documented as future orchestration only; the database remains the source of truth.
- No automatic email sending. Emails are drafted only.
- Gemini extraction cannot bypass eligibility rules or review approval. Human review is always mandatory.

## 6a. Latest Review Decision Semantics
- Multiple `ReviewDecision` rows per `ExtractedPerson` are retained as **review history**.
- Only the **latest** decision (by `decidedAt` timestamp, then by record order for deterministic ties) is authoritative.
- If a person is approved and later rejected, the latest rejection wins — they are excluded from email/export.
- If a person is rejected and later approved, the latest approval wins — they are included (if otherwise eligible).
- The latest reviewer note is retained on the current review state.

## 6b. Company-Scoped Email and Export
- Email drafts and exports are **strictly company-scoped**. Only people belonging to the selected company (via `ExtractedPerson.companyId`) are ever considered.
- No cross-company leakage is permitted. A regression test proves this.

## 6c. CRM-Ready Export as Integration Boundary
- With no live CRM API configured, the **CRM-ready export** (JSON + CSV + manifest) is the current integration boundary.
- Export records are durable: each export stores an export ID, company, included person IDs, file paths, manifest, and `status: exported`.
- The app never claims `synced` unless a real, authenticated CRM API call succeeded.

## 7. Safety Rules
- The **CRM database / app state is the single source of truth**, never agent memory.
- No CRM write without explicit human approval.
- CRM writes must be idempotent.
- Screenshot provenance is preserved internally but never exposed in Paul-facing emails.
- Original screenshots are stored permanently; deletion is an explicit, logged action — never silent.
- No secrets in the repo. No hardcoded API keys. `.env` is gitignored.

## 8. Build Phases
- **Round 1 — Repo Spine & Local Persistence:** folder structure, spec/governance docs, shared types + Zod + eligibility/ranking + tests, local API with real persistence, web review UI shell, email formatter + tests, evidence.
- **Round 2 — Review Workflow & CRM Data Engine (this round):** latest-review-state projection, company-scoped export/email, review console UI, edit-before-approval, durable export records (JSON/CSV/manifest), duplicate detection, status summary, data integrity checks, dev seed/reset, Round 3 prep docs.
- **Round 3 — Gemini Extraction:** wire Gemini multimodal structured JSON extraction (identity-locked to `nilhan.dev@gmail.com`), with Google Cloud Vision / Document AI OCR as optional backup.
- **Round 4 — ADK Orchestration:** introduce ADK agents as orchestration over the database; database stays source of truth.
- **Round 5 — Deployment:** Hostinger/GCP hosting under `nilhan.dev@gmail.com` only.

## 9. Identity Lock (summary)
All Google/Firebase/GCP/Gemini/ADK/Hostinger resources must be owned, created, billed, administered, and configured only through **nilhan.dev@gmail.com**. See `IDENTITY_LOCK.md`.

## Round 4: Production Readiness

### Production-readiness features added
- **Local backup script** (`scripts/backup-data.mjs`): creates timestamped backup folders under `data/backups/<id>/` with a SHA-256 manifest of every backed-up file.
- **Backup verification** (`scripts/verify-backup.mjs`): recomputes and verifies every SHA-256 hash in a backup manifest against the stored files; reports PASS/FAIL.
- **Audit logging**: an append-only audit log writer (`apps/api/src/audit/writer.ts`) records 10 event types (see `DATA_MODEL.md` → `AuditEvent`). Audit events are stored in the `audit_events.json` collection and exposed read-only via the `/api/audit` endpoint.
- **Health diagnostics**: the `GET /api/health` endpoint was expanded from a minimal field set to comprehensive diagnostics, including app version, git commit, rules/schema/prompt versions, storage writability, Gemini status, and DB counts (storage/gemini/version fields).
- **Export verification** (`scripts/verify-exports.mjs`): verifies that exports are company-scoped, include latest-approved-only people, exclude vague-mutual-only people, and that file hashes match the manifest.
- **Export manifest hardening**: export manifests now carry `liveCrmSync=false`, `companyId`, `approvedPersonIds`, `sourceReviewStateBasis`, `extractionSchemaVersion`, and `fileHashes` (json + csv with `sha256` and `sizeBytes`).
- **Config centralization** (`apps/api/src/config.ts`): a single config module holds `GEMINI_CONFIG`, `NODE_ENV`, `PATHS.backups`, and safe storage helpers so configuration is read from environment only.
- **Frontend diagnostics + audit panels**: the web UI now shows a diagnostics panel (version/mode/storage/Gemini status) and an audit panel (read-only audit events).

### Data safety
- **Local backup/restore**: backups are created locally under `data/backups/<id>/` and can be restored locally. No data leaves the machine.
- **Restore-readiness docs**: full backup and restore procedures are documented in `docs/BACKUP_AND_RESTORE.md`.

### Deployment boundary
- **NO live cloud deployment yet.** The app runs locally only.
- **NO live CRM sync yet.** The export contract (JSON/CSV/manifest) remains the only write path; `liveCrmSync=false`.
- **NO ADK agent built.** ADK remains documented as future orchestration only; the database is still the source of truth.
- **Gemini still pending live key.** The `GEMINI_API_KEY` is not set, so the live Gemini extraction path is untested in this round. The missing-key path is proven to fail cleanly with `missing_credentials` and invents no people.

### Business rules (unchanged)
All Round 1–3 business rules remain in force and unchanged:
- Manual screenshot upload only — no scraping, no browser automation against LinkedIn.
- Current-company-only selection.
- Named mutuals only (vague counts recorded but excluded from email).
- Vague-mutual-only people excluded.
- Caps: max 7 named mutuals per person, max 10 people per company export.
- Approval gate: human review is mandatory; Gemini cannot bypass it.
- Latest-review-wins: only the latest `ReviewDecision` per person is authoritative.
- Company-scoped export: no cross-company leakage.
- Plain-text Paul emails: no Markdown, no source/OCR/extraction wording.

## Round 5 — Bulk Screenshot Intake + Company Auto-Assignment

### Bulk intake workflow added
- **Bulk screenshot intake endpoint** (`POST /api/intake/bulk-screenshots`): Accepts up to 50 screenshot files, stores them with full provenance (original filename, SHA-256 hash, storage path), runs Gemini extraction (if key present), runs deterministic company inference, creates/reuses companies on high confidence, assigns screenshots and extracted people to those companies, and returns a summary.
- **Intake batch tracking**: `IntakeBatch` entity records status (`processing`/`completed`/`partial`/`failed`), counts of screenshots received/assigned/unassigned, companies created/reused, people extracted.
- **Deterministic company inference**: Weighted scoring model (current_role=3x, profile_mention=2x, past=1x, ad/noise=0.5x). High confidence threshold: ≥2 current-role mentions AND ≥60% share AND no strong runner-up. Below threshold → `needsCompanyReview: true`.
- **Company auto-creation/reuse**: High-confidence companies are created with `autoCreated=true`, `inferenceConfidence`, `normalizedName`, `aliases`, or matched to existing companies by normalized name + aliases.
- **Unassigned state**: Low-confidence screenshots are stored with `needsCompanyReview=true` and returned via `GET /api/intake/unassigned`.
- **Left panel updates**: After bulk intake, company list refreshes automatically. Auto-created companies appear in the sidebar.
- **Company-scoped viewing preserved**: All existing company-scoped filters remain. Unassigned screenshots never appear under a normal company.

### Extraction schema extended
- `CompanyCandidateSchema`: captures per-candidate company name, signal type, mention count, evidence text.
- `ScreenshotCompanyInferenceSchema` (optional, backward-compatible): targetCompanyCandidates, dominantCurrentCompanyName, confidence, isMixedCompanyScreenshot, needsCompanyReview, reasoningShort.

### Soft Master Relationship Database foundation
- Every screenshot stores SHA-256, original filename, storage path, intake batch ID.
- Every extracted person stores source screenshot IDs, confidence, provenance.
- Every mutual contact stores source screenshot ID linking back to origin.
- Companies track aliases, normalized name, auto-creation flag, inference confidence.
- Conservative approach: no identity resolution, no graph database, no CRM sync.

### Business rules (unchanged)
All Round 1–4 business rules remain in force and unchanged.

### Rules version
- **Rules version remains `4.0.0`.** Inference is a new feature, not a rules change.**
