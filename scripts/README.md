# scripts/

Operational helper scripts for CRM Feed.

## verify-evidence.mjs
Verifies a round's Evidence ZIP: confirms it exists, is non-zero, extract-tests it into a temp folder, and checks that the required Evidence files are present. Prints a PASS/FAIL summary and writes `Evidence/zip_verification.txt`.

Usage:
```bash
node scripts/verify-evidence.mjs Evidence/crm_feed_phase_1_repo_spine_evidence.zip
```
