# Evidence Requirements

## Required evidence per round
Every round must produce an **Evidence** folder at the repo root (`/Evidence`) containing proof that the round's work was really done. Evidence is never fabricated.

### Required files (per round, unless a round explicitly scopes a subset)
- `initial_tree.txt` — directory tree before the round's changes.
- `initial_git_status.txt` — `git status` before changes.
- `final_tree.txt` — directory tree after changes.
- `final_git_status.txt` — `git status` after changes.
- `commands_run.txt` — every command executed during the round, with outputs where useful.
- `test_output.txt` — full output of the test run.
- `build_output.txt` — full output of the build.
- `phase_<n>_notes.md` — short narrative of what was done, decisions, and blockers.
- `files_changed.txt` — list of files created/modified.

If a UI is opened in a round, add screenshots (`.png`) to Evidence as well.

## Commands run
- Record the exact commands executed (install, build, test, typecheck, lint, git).
- Include exit codes or success/failure where observable.

## Test output
- The real, unedited output of `npm run test` (and typecheck if separate).
- If tests fail, the failure output is evidence — do not fake a pass.

## Build output
- The real output of `npm run build`.
- If the build fails, record the failure.

## Git diff summary
- `files_changed.txt` lists created/modified files.
- `final_git_status.txt` shows the post-round state.

## Evidence ZIP requirement
At the end of each round, create a ZIP of the entire `Evidence` folder at:
```
Evidence/crm_feed_phase_<n>_<slug>_evidence.zip
```
For Round 1:
```
Evidence/crm_feed_phase_1_repo_spine_evidence.zip
```
For Round 2:
```
Evidence/crm_feed_phase_2_review_crm_engine_evidence.zip
```
The ZIP itself is gitignored (it is regenerated each round and is large).

## ZIP exclusion rules (Round 2+)
Evidence ZIPs must **never** include:
- `node_modules/` — dependency folders
- `dist/` or `build/` — compiled output folders
- `data/uploads/` image payloads (unless tiny and necessary for proof)
- `.env` files or any secrets
- Large binary files not directly part of evidence

The ZIP should contain only the `Evidence/` folder's text/markdown evidence files.

## Round 2 additional evidence requirements
- **API smoke evidence:** full output of the API smoke test proving the real workflow works.
- **Review workflow evidence:** proof that latest-review projection works (approve→reject excluded, reject→approve included).
- **Export evidence:** proof that exports are company-scoped (no cross-company leakage) and produce JSON/CSV/manifest.
- **UI verification evidence:** screenshots (if browser tooling available) or detailed manual verification notes.
- **Data integrity evidence:** output of the data integrity check script.
- **Rules versioning evidence:** proof that rules version is recorded in exports/emails.

## Round 3 additional evidence requirements
- **Gemini config evidence:** proof that Gemini configuration is read from environment only, with no secrets in source.
- **Missing-key failure evidence:** proof that missing GEMINI_API_KEY results in `pending_credentials` status and no fake people.
- **Malformed-output failure evidence:** proof that malformed Gemini JSON is rejected with `malformed_json` error category.
- **Schema-invalid failure evidence:** proof that schema-invalid Gemini output is rejected with `schema_validation_failed` error category.
- **API extraction request/response evidence:** sanitized request/response summaries from extraction endpoints.
- **UI extraction evidence:** screenshots or detailed manual verification of extraction controls, status display, attempt history, confidence display.
- **No-secret ZIP verification:** proof that the Evidence ZIP contains no API keys, .env files, or secrets.
- **No-bypass-review evidence:** proof that Gemini-extracted people do not appear in email/export before approval.
- **Confidence display evidence:** proof that person-level and field-level confidence is shown in review cards.
- **Raw response storage evidence:** proof that raw Gemini responses are stored internally without secrets.

## Zip verification requirement
After creating the ZIP:
1. Confirm it exists.
2. Confirm it has a non-zero size.
3. Extract-test it into a temporary verification folder (not the live Evidence folder).
4. Confirm the required Evidence files are present in the extracted content.
5. Record the verification result in `Evidence/round_<n>_zip_verification.txt` (path, size, file count, list of confirmed required files, PASS/FAIL).

## Round 4 Evidence Discipline

### External ZIP verification
The final ZIP verification file (e.g. `round_<n>_zip_verification.txt`) must live **beside** the ZIP in the Evidence folder, **not inside** the ZIP itself. Embedding the verification inside the ZIP makes it self-referential: its own size/count would change the ZIP it is trying to describe, causing a size mismatch on every regeneration. Keep the verification artifact external.

### Claim-to-evidence matrix
Every important final claim made in a round (in the spec, changelog, or acceptance doc) must map to a concrete evidence file. The matrix uses four columns:

| claim | evidence | verification-method | caveat |
|-------|----------|---------------------|--------|

- **claim** — the assertion (e.g. "exports are company-scoped").
- **evidence** — the file/script output that proves it.
- **verification-method** — how the evidence was produced (command, script).
- **caveat** — any limitation (e.g. "Gemini path untested; missing-key path only").

Claims with no evidence row are treated as unsupported and must be dropped or marked as future work.

### Post-commit evidence handling
Post-commit git truth files (e.g. `final_git_status.txt` regenerated after a commit) are staged **outside** the repo / outside the committed Evidence folder, not amended back into the commit. This avoids the self-referential stale-evidence cycle seen in Round 3B, where amending a commit changed the HEAD hash, which made the in-commit evidence stale, which forced another amend, ad infinitum. Post-commit artifacts are kept alongside Evidence but are not part of the committed truth set for that commit.

### No self-referential ZIP verification inside final ZIP
Re-stated for emphasis: a verification file that describes the ZIP's size/file-count must never be placed inside the ZIP it describes. The act of adding the file changes the ZIP's size and (possibly) file count, invalidating the very figures it reports. Always external.

### Stale-value sweep
Before claiming a round PASS, sweep all evidence files for stale values that no longer match the final committed state:
- Stale **HEAD** / commit hashes (compare against `git rev-parse HEAD`).
- Stale **ZIP sizes** or **file counts** (compare against the actual ZIP on disk).
- Stale **test counts** (compare against the latest `npm run test` output).
- Stale **lint counts** (compare against the latest `npm run lint` output).

Any mismatch must be corrected (regenerate the evidence artifact) before PASS is recorded.
