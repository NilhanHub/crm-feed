# Round 1 Acceptance Criteria

Round 1 delivers the repo spine, governance docs, shared logic, local API, web shell, email formatter, tests, and evidence. Every item below must PASS.

## Phase 1 — Repo inspection and setup
- [ ] 1. Project folder inspected; initial tree + git status recorded in Evidence. Empty folder handled correctly.
- [ ] 2. Git repo initialised (or preserved); branch `phase-1-repo-spine` created and checked out. No destructive git commands used.
- [ ] 3. Folder structure created exactly: `apps/web`, `apps/api`, `packages/shared`, `docs`, `Evidence`, `data/uploads`, `data/db`, `data/exports`, `scripts`. npm workspaces used.

## Phase 2 — Spec and governance docs
- [ ] 4. `docs/MASTER_SPEC.md` exists with app name, purpose, primary user, output user, core workflow, non-goals, safety rules, build phases.
- [ ] 5. `docs/IDENTITY_LOCK.md` exists and locks all Google/Firebase/GCP/Gemini/ADK/Hostinger resources to `nilhan.dev@gmail.com`.
- [ ] 6. `docs/DATA_MODEL.md` defines all 10 entities with fields, IDs, relationships, status values, lifecycle.
- [ ] 7. `docs/SCREENSHOT_EXTRACTION_SCHEMA.md` defines the structured JSON schema with all required fields including vague-count exclusion.
- [ ] 8. `docs/ELIGIBILITY_RULES.md` encodes all business rules (current-only, named-mutual-only, caps, prioritisation, de-prioritisation, dedupe).
- [ ] 9. `docs/CRM_WRITE_POLICY.md` defines no-write-without-approval, idempotency, provenance, no source wording in emails, export contract fallback.
- [ ] 10. `docs/AGENT_WORKFLOW.md` defines the 6 future ADK agents; states ADK is orchestration only and DB is source of truth.
- [ ] 11. `docs/EVIDENCE_REQUIREMENTS.md` defines per-round evidence, commands, test/build output, ZIP + verification requirements.
- [ ] 12. `docs/ROUND_1_ACCEPTANCE.md` lists these criteria.

## Phase 3 — App foundation
- [ ] 13. `packages/shared` has shared TS types, Zod schemas, deterministic eligibility rules, ranking function, and unit tests for eligibility + ranking.
- [ ] 14. `apps/api` has real local persistent storage (atomic JSON store or SQLite), stores uploads in `data/uploads`, health endpoint, company + batch + screenshot upload + extraction-run create + review decision + email draft endpoints. No fake extraction; runs start as `pending_extraction`/`pending_credentials` and allow attaching a real payload.
- [ ] 15. `apps/web` is React + Vite + TS with premium layout, company selector/create, batch upload, screenshots list, extraction status, review queue (real records only), email draft preview (approved only), clear empty states, no fake sample people.
- [ ] 16. Root scripts: `npm install`, `npm run dev`, `npm run build`, `npm run test`, `npm run lint`, `npm run typecheck` all defined.
- [ ] 17. `README.md` with what the app does, Round 1 scope, what's not implemented yet, quick start, identity lock summary, no-scraping policy, evidence policy, next phases.

## Phase 4 — Email draft rules
- [ ] 18. Email formatter implemented in real code with the exact format, no Markdown bold, no source wording, max 7 named mutuals, max 10 people, approved + currently-at-target only.
- [ ] 19. Email formatter tests cover: past-only excluded, no-named-mutual excluded, vague counts excluded, max 7 mutuals, max 10 people, plain names no Markdown bold.

## Phase 5 — Quality, tests, evidence
- [ ] 20. `npm install`/`build`/`test`/`typecheck` run; outputs saved to Evidence; failures fixed or clearly documented.
- [ ] 21. All Evidence files created: `initial_tree.txt`, `initial_git_status.txt`, `final_tree.txt`, `final_git_status.txt`, `commands_run.txt`, `test_output.txt`, `build_output.txt`, `phase_1_notes.md`, `files_changed.txt`.
- [ ] 22. Evidence ZIP created at `Evidence/crm_feed_phase_1_repo_spine_evidence.zip`.
- [ ] 23. ZIP verified (exists, non-zero, extract-tested, required files present, result in `Evidence/zip_verification.txt`).
- [ ] 24. Committed on `phase-1-repo-spine` with message `phase 1 crm feed repo spine` if repo is clean enough; otherwise explained.
