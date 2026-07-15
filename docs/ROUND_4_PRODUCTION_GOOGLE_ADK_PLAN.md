# Round 4 — Production Deployment Plan (Google / Firebase / GCP / ADK)

This document is a **plan only**. No cloud resources are created, provisioned, or billed in Round 4. All resource creation is deferred to a future round and will be performed **only** under the identity `nilhan.dev@gmail.com`.

## Identity lock
All Google Cloud, Firebase, Gemini, ADK, Cloud Run, Cloud Storage, Secret Manager, and deployment resources must be owned, created, billed, administered, and configured **only** through **nilhan.dev@gmail.com**. No other identity. See `docs/IDENTITY_LOCK.md`.

---

## 1. Recommended production architecture
- **Local-first (current state):** JSON file DB (atomic store under `data/db`), Express API, React SPA, manual screenshot upload, manual local backup (`scripts/backup-data.mjs`).
- **Future (target state):** Firebase (Firestore + Auth + Hosting) + Cloud Run (API) + Gemini API + Cloud Storage (screenshots/exports/backups) + Cloud Scheduler (scheduled backups). The local-first app remains the source of truth until migration is executed.

## 2. Local-first current state
- **Database:** atomic JSON collections under `data/db` (14 collections, see `DATA_MODEL.md`).
- **API:** Express + TypeScript in `apps/api`, serving on `PORT` (default 8787).
- **Web UI:** React + Vite SPA in `apps/web`, served on `:5173`.
- **Screenshots:** stored permanently under `data/uploads` (sha256-hashed).
- **Exports:** written under `data/exports` (JSON + CSV + manifest, `liveCrmSync=false`).
- **Backups:** created manually under `data/backups/<id>/` with a SHA-256 manifest; verified with `scripts/verify-backup.mjs`.
- **Audit:** append-only `audit_events.json` collection, read-only via `/api/audit`.

## 3. Google / Firebase / GCP resources likely needed
| Component | Likely service | Notes |
|-----------|----------------|-------|
| Firebase project | Firebase project under `nilhan.dev@gmail.com` | Owns all downstream resources. |
| Database | Firestore (Native mode) | Replaces local JSON store; 14 collections map 1:1. |
| Auth | Firebase Auth | Single operator (Nilhan) for now; multi-user later. |
| Hosting (web) | Firebase Hosting or Cloud Run | Serves the React SPA. |
| API | Cloud Run | Containerised Express API; auto-scales to zero. |
| Extraction | Gemini API (Generative Language API) | Same SDK as Round 3 (`@google/genai`). |
| Screenshots / exports | Cloud Storage | Buckets for `uploads`, `exports`, `backups`. |
| Backups | Cloud Scheduler → backup job | Triggers backup on a schedule; writes to Cloud Storage. |
| Secrets | Secret Manager | Holds `GEMINI_API_KEY` and future CRM credentials. |
| Logging / monitoring | Cloud Logging + Cloud Monitoring | App logs, health-endpoint monitoring, integrity alerts. |

## 4. Account / identity
- **ALL resources under `nilhan.dev@gmail.com`** — no other identity creates, owns, bills, or administers anything.
- Billing account, project ownership, IAM roles, and API keys are all attached to this single identity.

## 5. Secret handling
- `GEMINI_API_KEY` (and future CRM credentials) live in **Secret Manager** or **env vars only** — never in the repo, never in source, never in Evidence.
- Cloud Run / Cloud Functions mount secrets as env vars or access them via the Secret Manager SDK.
- `.env` remains gitignored; `.env.example` contains placeholders only.

## 6. Storage / database plan
- Migrate local JSON store → **Firestore** collections (1:1 mapping; see `DATA_MODEL.md`).
- Migrate `data/uploads` screenshots → **Cloud Storage** bucket (`crm-feed-uploads`); `storagePath` updated to GCS URI; object versioning enabled.
- Migrate `data/exports` → **Cloud Storage** bucket (`crm-feed-exports`).
- Migration is a one-time scripted operation (`scripts/migrate-to-firestore.mjs`, to be built); the local-first store remains until migration is verified.

## 7. Backup plan
- **Cloud:** Cloud Scheduler triggers a backup job that writes a timestamped, SHA-256-manifested backup to a Cloud Storage bucket (`crm-feed-backups`).
- **Local (current):** `scripts/backup-data.mjs` creates local timestamped backups; `scripts/verify-backup.mjs` verifies them.
- **Retention:** daily backups retained for 30 days; weekly snapshots retained for 12 months (target policy; not yet enforced).
- See `docs/BACKUP_AND_RESTORE.md` for the current local restore procedure.

## 8. Audit log plan
- `audit_events` → **Firestore collection** (append-only; same 10 event types).
- **Retention policy:** audit events retained indefinitely (or per a future compliance policy); never mutated or deleted.
- Exposed read-only via `/api/audit` (same contract as local).

## 9. Gemini key setup plan
1. Create the API key under `nilhan.dev@gmail.com` in Google AI Studio (https://aistudio.google.com/apikey).
2. Store it in **Secret Manager** (and/or as a Cloud Run env var secret).
3. Verify the **missing-key → available** transition: with the key absent, extraction returns `missing_credentials` and creates 0 people; with the key present, the live path becomes available.
4. Test one live extraction end-to-end before declaring the live path production-ready. (This is the primary Round 5 task.)

## 10. ADK orchestration boundary
- ADK agents **orchestrate only**; they never own data. The database (Firestore in production) is the single source of truth.
- If all ADK agents were removed, the database must still fully describe current state.
- Agents hold no business state in memory; every decision is persisted before responding.
- See `docs/ADK_ORCHESTRATION_BOUNDARY.md` for the full boundary, risks, and prerequisites.

## 11. Rollback plan
- **Code:** `git revert` the offending commit(s) and redeploy.
- **Data:** restore from the most recent verified backup (`docs/BACKUP_AND_RESTORE.md`); in production, restore Firestore from the scheduled Cloud Storage export.
- Rollback is rehearsed before any production cutover.

## 12. Monitoring / logging plan
- App logs ship to **Cloud Logging**.
- **Health-endpoint monitoring:** synthetic check against `GET /api/health` (app version, git commit, rules/schema/prompt versions, storage writability, Gemini status, DB counts).
- **Integrity-check alerts:** alert if the data-integrity check reports `fail`.
- Alert on 5xx spike, extraction failure rate, and Gemini quota usage.

## 13. Cost-control notes
- **Gemini retries capped at 2** (`GEMINI_MAX_RETRIES`, default 2).
- **Batch extraction is sequential**, not parallel — bounds concurrent cost.
- **Storage lifecycle rules:** move old screenshots/exports/backups to colder storage classes; delete per retention policy.
- Cloud Run scales to zero when idle to avoid idle cost.

## 14. Out of scope for this round
- **No resource creation in this round.** Everything above is a plan.
- No live cloud deployment.
- No live CRM sync.
- No ADK agent built.
- No live Gemini extraction (key not set).
