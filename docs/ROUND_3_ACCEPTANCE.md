# Round 3 Acceptance Criteria

Round 3 adds real Gemini screenshot extraction to CRM Feed. Every item below must PASS.

## Phase 1 — Startup Inspection
- [ ] 1. Inspect repo state; produce round_3_initial_tree/git_status/git_log/repo_notes.
- [ ] 2. Create branch phase-3-gemini-extraction; produce round_3_branch.txt.
- [ ] 3. Read/summarise specs; produce round_3_spec_review.md.

## Phase 2 — Spec and Environment Hardening
- [ ] 4. Update MASTER_SPEC.md; produce round_3_master_spec_diff.md.
- [ ] 5. Update SCREENSHOT_EXTRACTION_SCHEMA.md; produce round_3_extraction_schema_diff.md.
- [ ] 6. Update DATA_MODEL.md; produce round_3_data_model_diff.md.
- [ ] 7. Update ENVIRONMENT.md; produce round_3_environment_diff.md.
- [ ] 8. Update EVIDENCE_REQUIREMENTS.md; produce round_3_evidence_requirements_diff.md.
- [ ] 9. Create ROUND_3_ACCEPTANCE.md; produce round_3_acceptance_doc.txt.

## Phase 3 — Shared Package
- [ ] 10. Add/strengthen extraction schemas; produce round_3_shared_extraction_schemas.txt.
- [ ] 11. Add Gemini-to-reviewable normalization; produce round_3_gemini_normalizer.txt.
- [ ] 12. Add confidence classification helpers; produce round_3_confidence_helpers.txt.
- [ ] 13. Add extraction error classification; produce round_3_error_classification.txt.
- [ ] 14. Add schema validation tests; produce round_3_schema_validation_tests.txt.
- [ ] 15. Add normalization tests; produce round_3_normalization_tests.txt.
- [ ] 16. Add error classification tests; produce round_3_error_classification_tests.txt.

## Phase 4 — API
- [ ] 17. Add Gemini extraction service; produce round_3_gemini_service_source_proof.txt.
- [ ] 18. Add Gemini prompt template; produce round_3_gemini_prompt_template.txt.
- [ ] 19. Add extract-one endpoint; produce round_3_extract_one_endpoint.txt, round_3_extract_one_request_response.txt.
- [ ] 20. Add extract-batch endpoint; produce round_3_extract_batch_endpoint.txt, round_3_extract_batch_request_response.txt.
- [ ] 21. Add retry endpoint; produce round_3_retry_endpoint.txt, round_3_retry_request_response.txt.
- [ ] 22. Add attempt history endpoint; produce round_3_attempt_history_endpoint.txt.
- [ ] 23. Add safe raw-response audit storage; produce round_3_raw_response_storage.txt.
- [ ] 24. Add extraction status values; produce round_3_extraction_statuses.txt.
- [ ] 25. Add missing credentials test; produce round_3_missing_credentials_test.txt.
- [ ] 26. Add malformed output test; produce round_3_malformed_output_test.txt.
- [ ] 27. Add schema-invalid output test; produce round_3_schema_invalid_output_test.txt.
- [ ] 28. Add partial/low-confidence test; produce round_3_low_confidence_test.txt.
- [ ] 29. Add no-bypass-review test; produce round_3_no_bypass_review_test.txt.
- [ ] 30. Real Gemini smoke or missing-key proof; produce round_3_real_gemini_smoke_or_missing_key.txt.

## Phase 5 — Frontend
- [ ] 31. Add extraction controls; produce round_3_frontend_extraction_controls.txt.
- [ ] 32. Add extraction status display; produce round_3_frontend_status_display.txt.
- [ ] 33. Add attempt history display; produce round_3_frontend_attempt_history.txt.
- [ ] 34. Add confidence display to review cards; produce round_3_frontend_confidence_display.txt.
- [ ] 35. Preserve manual JSON import UI; produce round_3_manual_import_preserved.txt.
- [ ] 36. Add frontend error/empty states; produce round_3_frontend_error_states.txt.
- [ ] 37. Capture UI screenshots or document tooling failure; produce round_3_ui_screenshot_or_tooling_failure.txt.

## Phase 6 — Data Integrity
- [ ] 38. Extend data integrity checker; produce round_3_data_integrity_script.txt, round_3_data_integrity_output.txt.
- [ ] 39. Add no-secret scanner; produce round_3_no_secret_scan.txt.
- [ ] 40. Update dev seed/reset; produce round_3_dev_seed_reset_update.txt.
- [ ] 41. Add rules/version metadata; produce round_3_versioning.txt.

## Phase 7 — Docs
- [ ] 42. Update CHANGELOG.md; produce round_3_changelog.txt.
- [ ] 43. Create ROUND_4_PRODUCTION_GOOGLE_ADK_PLAN.md; produce round_3_round_4_plan.txt.
- [ ] 44. Update README.md; produce round_3_readme_diff.txt.
- [ ] 45. Create/update .env.example; produce round_3_env_example.txt.

## Phase 8 — Tests, Build, Lint
- [ ] 46. Run typecheck; produce round_3_typecheck_output.txt.
- [ ] 47. Run tests; produce round_3_test_output.txt.
- [ ] 48. Run build; produce round_3_build_output.txt.
- [ ] 49. Run lint; produce round_3_lint_output.txt.
- [ ] 50. Run API smoke test; produce round_3_api_smoke_test_output.txt, round_3_api_smoke_test_notes.md.
- [ ] 51. Run data integrity; produce round_3_data_integrity_output.txt.
- [ ] 52. Run no-secret scan; produce round_3_no_secret_scan_output.txt.
- [ ] 53. Run or document UI verification; produce round_3_ui_verification.txt.

## Phase 9 — Adversarial Self-Review
- [ ] 54. Run adversarial self-review; produce round_3_adversarial_self_review.md.
- [ ] 55. Add source-proof evidence; produce round_3_critical_source_proof.md.

## Phase 10 — Final Evidence and Git
- [ ] 56. Save final tree/git status/log; produce round_3_final_tree.txt, round_3_final_git_status.txt, round_3_final_git_log.txt.
- [ ] 57. Save changed files + diff summary; produce round_3_files_changed.txt, round_3_diff_summary.md.
- [ ] 58. Save commands run; produce round_3_commands_run.txt.
- [ ] 59. Save round notes; produce round_3_notes.md.
- [ ] 60. Create Evidence ZIP.
- [ ] 61. Verify Evidence ZIP; produce round_3_zip_verification.txt.
- [ ] 62. Commit; produce round_3_commit.txt.
