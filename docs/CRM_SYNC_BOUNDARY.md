# CRM Sync Boundary

This document defines exactly where the CRM Feed pipeline ends today and where a future live CRM sync would begin.

---

## No live CRM sync is built yet

There is **no live CRM sync** in this project. Nothing in CRM Feed writes to an external CRM system. No CRM API is called. The pipeline stops at producing a verified export contract on disk.

---

## Current output: a verified export contract

The final stage of the pipeline writes an **export bundle** to `data/exports/`. Each bundle contains:

- a **JSON** representation of the approved records,
- a **CSV** version for import tooling,
- a **manifest** with file hashes for integrity verification.

The `CrmSyncRecord` status for exported data is `"exported"` — **not** `"synced"`. The word "synced" is reserved for a future state in which an external CRM has actually ingested the records.

---

## What would be needed for a future live sync

Before any live sync adapter is built, the following must be defined and owned:

- **Target CRM API endpoint** — the exact URL the adapter will call.
- **Auth credentials** — how the adapter authenticates to the CRM API (token, OAuth, service account).
- **Field mapping** — mapping between CRM Feed export fields and CRM target fields.
- **Rate limits** — the CRM API's rate-limit policy, so the adapter can throttle.
- **Retry policy** — how transient failures are retried (backoff, max attempts).
- **Idempotency key** — a stable key per record so re-syncs do not create duplicates.

---

## How live sync would be tested later

A future CRM sync adapter would:

1. Read export batches from `data/exports/` (or via an API endpoint that serves them).
2. Apply the field mapping to each record.
3. Call the CRM API with the idempotency key, honoring rate limits and retry policy.
4. On success, update the `CrmSyncRecord` status from `"exported"` to `"synced"`.

This adapter does not exist yet and is explicitly out of scope for the current build.

---

## Failure behavior

If a future sync attempt fails:

- The `CrmSyncRecord` status becomes `"failed"` and the error message is recorded.
- The **export files remain on disk** in `data/exports/` as a durable fallback.
- **No data is lost** — the export contract is the recoverable unit, independent of whether sync succeeded.

Because exports are written before any sync attempt, a failed sync is always recoverable by re-running the adapter against the existing bundle.

---

## Rollback and audit expectations

The pipeline is designed to be auditable and reversible:

- The **audit log** records `export_created` events, so every export is traceable.
- **Raw extraction responses** are stored for audit, so the source-of-truth evidence for each extracted field is preserved.
- Export **manifests include file hashes** (`sha256`) for integrity verification, so tampering or corruption is detectable.

---

## The boundary

The pipeline is a chain of explicit gates:

```
extraction → review → approval → export → (future) CRM sync
```

Each arrow is a **gate**. Nothing advances to the next stage until the previous one passes. Critically:

- **Extraction** produces draft data that must be reviewed.
- **Review** is a human gate — a human approves or rejects.
- **Approval** is the gate that unlocks export eligibility.
- **Export** writes the verified contract to disk with status `"exported"`.
- **CRM sync** is a *future* gate after export — it does not exist yet.

This boundary is intentional: it keeps a human in the loop and keeps the export contract as a durable, auditable artifact before any external system is touched.
