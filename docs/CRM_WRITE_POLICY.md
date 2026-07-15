# CRM Write Policy

## Core rules
1. **No CRM write without explicit human approval.** A `CrmSyncRecord` is only created from a person whose `ReviewDecision.decision === "approved"`. Rejected/deferred people are never written.
2. **CRM writes must be idempotent.** Re-running an export or sync for the same `(companyId, extractedPersonId)` must not create duplicate records. The adapter must look up an existing `CrmSyncRecord` by this key and update in place rather than insert again.
3. **Preserve screenshot provenance internally.** Every `CrmSyncRecord` retains `extractedPersonId`, which links back to `sourceScreenshotIds`. This provenance is stored in the database and export metadata, never shown in Paul-facing emails.
4. **Do not expose screenshot/OCR wording in Paul emails.** The `EmailDraft.body` is plain text and contains only names, titles, locations, current roles, and named mutuals. See the email formatter in `packages/shared`.

## No live CRM API in Round 1
- In Round 1 there are **no live CRM credentials or endpoints**. The app must **not pretend** to sync.
- Instead, the app implements a real **export contract**: approved people are written to deterministic, reviewable export files under `data/exports` (JSON + CSV), and the corresponding `CrmSyncRecord.status` is set to `exported` with `exportPath` recorded.
- If an export cannot be written (disk error etc.), the record is `failed` with a clear error message.
- A `CrmSyncRecord` must never be marked `synced` unless a real, authenticated CRM API call succeeded. Until then, the honest status is `exported` or `not_implemented`.

## Future live CRM adapter (not implemented yet)
- When live CRM API details are provided (under the `nilhan.dev@gmail.com` identity lock), a real adapter will:
  - authenticate with real credentials (never hardcoded),
  - perform an idempotent upsert keyed on `(companyId, extractedPersonId)`,
  - record `syncedAt` and the remote CRM record id,
  - fail clearly with a useful message on any error.
- Until that adapter exists, the export contract is the only write path.

## Audit
- Every export/sync attempt is logged with timestamp, record ids, status, and any error.
- Export files include a manifest listing the source screenshots (provenance) for traceability, separate from the email draft.
