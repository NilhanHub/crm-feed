# Deployment Readiness Checklist

Complete every checkbox before deploying. Each section is a gate; do not deploy if any item is unchecked.

---

## Local gates

- [ ] `npm run lint` passes
- [ ] `npm run typecheck` passes
- [ ] `npm test` passes
- [ ] `npm run build` passes
- [ ] `data-integrity-check` passes (`node scripts/data-integrity-check.mjs`)
- [ ] `no-secret-scan` finds 0 real secrets
- [ ] export verification passes
- [ ] backup verification passes (`node scripts/verify-backup.mjs`)

---

## Secrets checklist

- [ ] no `.env` file committed
- [ ] `.env.example` has placeholders only (no real values)
- [ ] `GEMINI_API_KEY` not present in any evidence/ZIP/log
- [ ] no API keys in source code

---

## Account identity checklist

- [ ] all Google/Firebase/GCP resources under `nilhan.dev@gmail.com`
- [ ] no other identity used

---

## Gemini credential checklist

- [ ] `GEMINI_API_KEY` documented
- [ ] missing-key path tested (extraction fails correctly when the key is absent)
- [ ] no fake Gemini success claimed

---

## Data migration checklist

- [ ] backup created before migration
- [ ] backup verified
- [ ] `data-integrity-check` passes after migration

---

## Backup checklist

- [ ] backup script runs (`node scripts/backup-data.mjs`)
- [ ] backup verified (`node scripts/verify-backup.mjs`)
- [ ] restore procedure documented (see `docs/BACKUP_AND_RESTORE.md`)

---

## Smoke-test checklist

- [ ] health endpoint responds
- [ ] company creation works
- [ ] screenshot upload works
- [ ] missing-key extraction fails correctly
- [ ] manual import works
- [ ] review approval works
- [ ] email preview shows clean Paul email
- [ ] export creates files
- [ ] audit events recorded

---

## Rollback checklist

- [ ] previous commit identified
- [ ] backup available
- [ ] rollback procedure documented

---

## Post-deploy audit checklist

- [ ] audit log recording events
- [ ] no unapproved people in exports
- [ ] no cross-company leakage
- [ ] health endpoint shows correct status
