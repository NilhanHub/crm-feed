# Round 2 Acceptance Criteria

Round 2 hardens the data engine, fixes Round 1 weaknesses, builds a real human review workflow, implements reliable company-scoped exports, improves the UI into a practical review tool, and produces complete evidence.

## Phase 1 — Startup Inspection
- [ ] 1. Inspect repo state; produce `round_2_initial_tree.txt`, `round_2_initial_git_status.txt`, `round_2_initial_git_log.txt`, `round_2_repo_notes.md`.
- [ ] 2. Create branch `phase-2-review-crm-engine`; produce `round_2_branch.txt`.
- [ ] 3. Read/summarise specs; produce `round_2_spec_review.md`.

## Phase 2 — Spec and Data Model Hardening
- [ ] 4. Update `MASTER_SPEC.md` with real review workflow, manual payload attach, latest review semantics, company-scoped email/export, CRM-ready export boundary; produce `round_2_master_spec_diff.md`.
- [ ] 5. Update `DATA_MODEL.md` with latest review state, review history, export batch/manifest, company-scoped selection, dedupe, provenance; produce `round_2_data_model_diff.md`.
- [ ] 6. Update `ELIGIBILITY_RULES.md` with all rules incl. latest approved state; produce `round_2_eligibility_rules_diff.md`.
- [ ] 7. Create `ROUND_2_ACCEPTANCE.md`; produce `round_2_acceptance_doc.txt`.
- [ ] 8. Update `EVIDENCE_REQUIREMENTS.md` with Round 2 requirements; produce `round_2_evidence_requirements_diff.md`.

## Phase 3 — Shared Package
- [ ] 9. Add review state types (ReviewDecisionHistory, CurrentReviewState, approved/rejected/needs_review, reviewer note, timestamp, reviewer identity); produce `round_2_shared_review_types.txt`.
- [ ] 10. Implement deterministic latest-review projection; produce `round_2_latest_review_projection.txt`.
- [ ] 11. Implement duplicate detection helpers (normalised name/company/title, preserve screenshot IDs, flag not delete); produce `round_2_dedupe_helpers.txt`.
- [ ] 12. Implement company-scoped selection helper (current at company, named mutual, latest approved, not past-only, max 10/7); produce `round_2_company_selection_helper.txt`.
- [ ] 13. Tests for review projection (approve→reject, reject→approve, older ignored, latest note, tie-break); produce `round_2_review_projection_tests.txt`.
- [ ] 14. Tests for company-scoped selection (company only, approved only, past-only excluded, no mutuals excluded, vague excluded, max 7, max 10); produce `round_2_company_selection_tests.txt`.
- [ ] 15. Tests for dedupe (exact, case-insensitive, punctuation, different company not merged, flagged not deleted); produce `round_2_dedupe_tests.txt`.

## Phase 4 — API Hardening
- [ ] 16. Fix export company-scoping bug + regression test; produce `round_2_export_company_scope_fix.txt`, `round_2_export_scope_regression_test.txt`.
- [ ] 17. Fix email latest-review state + regression test; produce `round_2_email_latest_review_fix.txt`, `round_2_email_latest_review_regression_test.txt`.
- [ ] 18. Harden manual extraction payload attach/import endpoint; produce `round_2_payload_import_endpoint.txt`, `round_2_payload_import_validation.txt`.
- [ ] 19. Add review queue endpoints (list by company, list by batch, person details, submit/update decision, history); produce `round_2_review_api_endpoints.txt`.
- [ ] 20. Add batch/company status summary endpoint; produce `round_2_status_summary_endpoint.txt`.
- [ ] 21. Add durable export records (export ID, company, person IDs, paths, manifest, status exported); produce `round_2_export_records.txt`.
- [ ] 22. Add CSV export (company, name, title, location, current role, mutuals, screenshot IDs, review status, date); produce `round_2_crm_csv_export.txt`.
- [ ] 23. Add JSON export (full structured data, provenance, review metadata, ranking/eligibility); produce `round_2_crm_json_export.txt`.
- [ ] 24. Add export manifest (export ID, paths, counts, rules version, app version, generatedAt); produce `round_2_export_manifest.txt`.
- [ ] 25. API smoke test for full real workflow; produce `round_2_api_smoke_test_output.txt`, `round_2_api_smoke_test_notes.md`.

## Phase 5 — Frontend Review Workflow
- [ ] 26. Improve frontend into practical review console; produce `round_2_frontend_features.txt`.
- [ ] 27. Add review cards (name, title, location, current/past roles, named mutuals, eligibility, ranking, source screenshots, latest review, approve/reject/needs-review); produce `round_2_review_card_features.txt`.
- [ ] 28. Add edit-before-approval (name, title, location, current role, mutual contacts; store edits without deleting provenance); produce `round_2_review_edit_features.txt`.
- [ ] 29. Add email preview behavior (approved latest-state, company-scoped, max 10/7, plain names, no Markdown, no source wording); produce `round_2_email_preview_ui.txt`.
- [ ] 30. Add export UI (export-ready count, JSON/CSV, manifest path, no sync claim); produce `round_2_export_ui.txt`.
- [ ] 31. Add strong empty/error states; produce `round_2_empty_error_states.txt`.
- [ ] 32. Capture UI screenshots or manual verification notes; produce `round_2_ui_screenshot_or_manual_verification.txt`.

## Phase 6 — Data Quality and Safety
- [ ] 33. Add dev seed/reset script (clearly named, not automatic, documented); produce `round_2_dev_seed_reset_script.txt`.
- [ ] 34. Add data integrity check script + output; produce `round_2_data_integrity_script.txt`, `round_2_data_integrity_output.txt`.
- [ ] 35. Add rules/version metadata in exports/emails; produce `round_2_rules_versioning.txt`.
- [ ] 36. Add CHANGELOG.md; produce `round_2_changelog.txt`.

## Phase 7 — Round 3 Prep
- [ ] 37. Create `ROUND_3_GEMINI_EXTRACTION_PLAN.md`; produce `round_2_round_3_plan.txt`.
- [ ] 38. Create `ENVIRONMENT.md`; produce `round_2_environment_doc.txt`.

## Phase 8 — Tests, Build, Lint, Typecheck
- [ ] 39. Run typecheck; produce `round_2_typecheck_output.txt`.
- [ ] 40. Run tests; produce `round_2_test_output.txt`.
- [ ] 41. Run build; produce `round_2_build_output.txt`.
- [ ] 42. Run lint; produce `round_2_lint_output.txt`.
- [ ] 43. Run API smoke test; produce `round_2_api_smoke_test_output.txt`.
- [ ] 44. Run data integrity script; produce `round_2_data_integrity_output.txt`.
- [ ] 45. Run or document UI verification; produce `round_2_ui_verification.txt`.

## Phase 9 — Final Evidence and Git
- [ ] 46. Save final tree and git status after all changes/commit; produce `round_2_final_tree.txt`, `round_2_final_git_status.txt`, `round_2_final_git_log.txt`.
- [ ] 47. Save changed files summary; produce `round_2_files_changed.txt`, `round_2_diff_summary.md`.
- [ ] 48. Save commands run; produce `round_2_commands_run.txt`.
- [ ] 49. Save round notes; produce `round_2_notes.md`.
- [ ] 50. Create Evidence ZIP (no node_modules/dist/secrets); produce `crm_feed_phase_2_review_crm_engine_evidence.zip`.
- [ ] 51. Verify Evidence ZIP; produce `round_2_zip_verification.txt`.
- [ ] 52. Commit with message `phase 2 review crm data engine`; produce `round_2_commit.txt`.
