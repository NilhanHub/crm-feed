# Backup and Restore

This document describes how CRM Feed data is backed up, how to verify a backup, and how to restore from one. Backups are **manual** — there is no automated scheduled backup yet.

---

## What is backed up

A backup captures the live, regenerable runtime data and the small set of repo-level files needed to recreate the environment:

| Included | Location | Why |
| --- | --- | --- |
| All JSON collections | `data/db/` | The CRM database (single source of truth) |
| Screenshots | `data/uploads/` | Uploaded evidence used for Gemini extraction |
| Export bundles | `data/exports/` | Verified export contracts (JSON + CSV + manifest) |
| `.env.example` | repo root | Documents required env vars (placeholders only) |
| `.gitignore` | repo root | Records what is intentionally excluded |
| `package.json` | repo root | App version and dependency contract |

## What is NOT backed up

The following are deliberately excluded — they are either regenerable, secret, or historical:

- `node_modules/` — regenerable from `package.json` via `npm install`
- `dist/` — regenerable via `npm run build`
- `.git/` — version control history, not runtime data
- `.env` — contains **real secrets** (e.g. `GEMINI_API_KEY`) and must never be copied into a backup bundle
- Old backups inside `data/backups/` — backups are not recursively backed up

---

## Creating a backup

Run the backup script from the project root:

```bash
node scripts/backup-data.mjs
```

This creates a **timestamped folder** under `data/backups/` (for example `data/backups/2026-07-03T10-15-00Z/`) and writes a `__backup_manifest.json` inside that folder describing every file copied.

The script copies the included locations listed above into the timestamped folder, mirroring their relative paths.

---

## Backup manifest structure

Each backup folder contains a `__backup_manifest.json` with the following shape:

```jsonc
{
  "backupId": "2026-07-03T10-15-00Z",        // timestamped folder name
  "createdAt": "2026-07-03T10:15:00.000Z",   // ISO timestamp
  "appVersion": "1.0.0",                      // from package.json
  "rulesVersion": "2026.07.03",               // extraction rules version
  "entries": [                                // one per backed-up file
    {
      "path": "data/db/companies.json",
      "sizeBytes": 2048,
      "sha256": "<hex digest>"
    }
  ],
  "totalFiles": 42,
  "totalBytes": 524288,
  "note": "Manual backup. Restore overwrites current data."
}
```

---

## Verifying a backup

After creating (or before restoring from) a backup, verify it:

```bash
# Verify the most recent backup
node scripts/verify-backup.mjs

# Verify a specific backup by its id (timestamped folder name)
node scripts/verify-backup.mjs 2026-07-03T10-15-00Z
```

The verifier checks:

1. **Existence** — the backup folder and manifest exist.
2. **Size** — each `entries[].sizeBytes` matches the actual file on disk.
3. **Manifest readability** — `__backup_manifest.json` parses and contains the required fields.
4. **Expected folders** — `data/db`, `data/uploads`, `data/exports` are present.
5. **No forbidden files** — rejects backups that contain `node_modules`, `dist`, `.git`, `.env`, or nested old backups.
6. **Hash verification** — recomputes `sha256` for every entry and compares against the manifest.

A passing verification prints a summary (`totalFiles`, `totalBytes`) and exits `0`. A failing check exits non-zero and lists the problem.

---

## Manual restore procedure

> **WARNING: Restore OVERWRITES current data.**
> Always create and verify a backup of the **current** data before restoring an older backup on top of it. Once overwritten, the current data cannot be recovered unless you backed it up first.

Steps:

1. **Back up current data first** (see *Creating a backup* above) and confirm verification passes.
2. **Stop the API server** so no process is writing to `data/` during the copy:
   ```bash
   # stop whatever process is running the API (e.g. Ctrl+C in its terminal)
   ```
3. **Copy files back** from the backup folder into the live locations, mirroring paths:
   - `<backup>/data/db/**` → `data/db/`
   - `<backup>/data/uploads/**` → `data/uploads/`
   - `<backup>/data/exports/**` → `data/exports/`
4. **Restart the API** and confirm it boots cleanly.
5. **Verify the restored data** by running the data integrity check (see below).

---

## Verifying restored data

After a restore, confirm the data is consistent end to end:

```bash
node scripts/data-integrity-check.mjs
```

This re-checks referential integrity across collections, confirms no orphaned uploads/exports, and updates `LAST_INTEGRITY_CHECK_STATUS`. A clean run means the restore is complete and consistent.

---

## Backup retention guidance

- Backups accumulate under `data/backups/`. The script does **not** delete old backups automatically.
- `data/backups/` is **gitignored** — backups never enter version control.
- Delete old backups manually when they are no longer needed:
  ```bash
  rm -rf data/backups/2026-06-01T08-00-00Z   # example
  ```
- Keep at least one verified backup that matches your last known-good state.

---

## Note on scheduling

There is **no automated scheduled backup** today. Backups are created manually via `node scripts/backup-data.mjs`. Treat backup creation as a required step before any migration, destructive operation, or deployment.
