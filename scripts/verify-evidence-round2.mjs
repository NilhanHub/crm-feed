// Verifies a Round 2 Evidence ZIP.
// Usage: node scripts/verify-evidence-round2.mjs <path-to-zip>
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const zipPath = process.argv[2];
const repoRoot = path.resolve(__dirname, "..");
const evidenceDir = path.join(repoRoot, "Evidence");

if (!zipPath) {
  console.error("Usage: node scripts/verify-evidence-round2.mjs <path-to-zip>");
  process.exit(2);
}

// Round 2 required files (checking by basename in extracted content)
const required = [
  "round_2_initial_tree.txt",
  "round_2_initial_git_status.txt",
  "round_2_initial_git_log.txt",
  "round_2_repo_notes.md",
  "round_2_branch.txt",
  "round_2_spec_review.md",
  "round_2_master_spec_diff.md",
  "round_2_data_model_diff.md",
  "round_2_eligibility_rules_diff.md",
  "round_2_acceptance_doc.txt",
  "round_2_evidence_requirements_diff.md",
  "round_2_shared_review_types.txt",
  "round_2_latest_review_projection.txt",
  "round_2_dedupe_helpers.txt",
  "round_2_company_selection_helper.txt",
  "round_2_review_projection_tests.txt",
  "round_2_company_selection_tests.txt",
  "round_2_dedupe_tests.txt",
  "round_2_export_company_scope_fix.txt",
  "round_2_export_scope_regression_test.txt",
  "round_2_email_latest_review_fix.txt",
  "round_2_email_latest_review_regression_test.txt",
  "round_2_payload_import_endpoint.txt",
  "round_2_payload_import_validation.txt",
  "round_2_review_api_endpoints.txt",
  "round_2_status_summary_endpoint.txt",
  "round_2_export_records.txt",
  "round_2_crm_csv_export.txt",
  "round_2_crm_json_export.txt",
  "round_2_export_manifest.txt",
  "round_2_api_smoke_test_output.txt",
  "round_2_api_smoke_test_notes.md",
  "round_2_frontend_features.txt",
  "round_2_review_card_features.txt",
  "round_2_review_edit_features.txt",
  "round_2_email_preview_ui.txt",
  "round_2_export_ui.txt",
  "round_2_empty_error_states.txt",
  "round_2_ui_screenshot_or_manual_verification.txt",
  "round_2_dev_seed_reset_script.txt",
  "round_2_data_integrity_script.txt",
  "round_2_data_integrity_output.txt",
  "round_2_rules_versioning.txt",
  "round_2_changelog.txt",
  "round_2_round_3_plan.txt",
  "round_2_environment_doc.txt",
  "round_2_typecheck_output.txt",
  "round_2_test_output.txt",
  "round_2_build_output.txt",
  "round_2_lint_output.txt",
  "round_2_ui_verification.txt",
  "round_2_final_tree.txt",
  "round_2_files_changed.txt",
  "round_2_diff_summary.md",
  "round_2_commands_run.txt",
  "round_2_notes.md",
  "round_2_zip_verification.txt",
  "round_2_commit.txt",
];

const lines = [];
function log(s) { lines.push(s); console.log(s); }

const exists = fs.existsSync(zipPath);
const size = exists ? fs.statSync(zipPath).size : 0;
log(`ZIP path: ${zipPath}`);
log(`Exists: ${exists}`);
log(`Size (bytes): ${size}`);

if (!exists || size === 0) {
  log("RESULT: FAIL (missing or empty zip)");
  fs.writeFileSync(path.join(evidenceDir, "round_2_zip_verification.txt"), lines.join("\n"), "utf8");
  process.exit(1);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "crmfeed-r2-zip-verify-"));
try {
  execSync(
    `powershell -NoProfile -Command "Expand-Archive -LiteralPath '${path.resolve(zipPath)}' -DestinationPath '${tmp}' -Force"`,
    { stdio: "pipe" }
  );
  const allFiles = [];
  function walk(dir, base = dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, base);
      else allFiles.push(path.relative(base, full).replace(/\\/g, "/"));
    }
  }
  walk(tmp);

  log(`Extracted file count: ${allFiles.length}`);

  const basenames = allFiles.map((f) => path.basename(f));
  const present = required.filter((r) => basenames.includes(r));
  const missing = required.filter((r) => !basenames.includes(r));

  log("Required files present:");
  for (const r of present) log(`  OK   ${r}`);
  if (missing.length > 0) {
    log("Required files MISSING:");
    for (const r of missing) log(`  MISS ${r}`);
  }

  // Check no node_modules or dist in zip
  const forbidden = allFiles.filter((f) => f.includes("node_modules") || f.includes("/dist/"));
  if (forbidden.length > 0) {
    log("FORBIDDEN files found in ZIP:");
    for (const f of forbidden) log(`  BAD  ${f}`);
  } else {
    log("No node_modules or dist in ZIP: OK");
  }

  const pass = missing.length === 0 && forbidden.length === 0;
  log(`RESULT: ${pass ? "PASS" : "FAIL"}`);

  fs.writeFileSync(path.join(evidenceDir, "round_2_zip_verification.txt"), lines.join("\n"), "utf8");
  process.exit(pass ? 0 : 1);
} catch (e) {
  const msg = (e && e.message) ? e.message : String(e);
  log(`RESULT: FAIL (extraction error: ${msg})`);
  fs.writeFileSync(path.join(evidenceDir, "round_2_zip_verification.txt"), lines.join("\n"), "utf8");
  process.exit(1);
} finally {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
}
