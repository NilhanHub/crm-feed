// Verifies a round's Evidence ZIP without relying on shell tools.
// Confirms: exists, non-zero size, extract-tests into a temp folder,
// required files present. Writes Evidence/zip_verification.txt.
//
// Usage: node scripts/verify-evidence.mjs <path-to-zip>
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
  console.error("Usage: node scripts/verify-evidence.mjs <path-to-zip>");
  process.exit(2);
}

const required = [
  "initial_tree.txt",
  "initial_git_status.txt",
  "final_tree.txt",
  "final_git_status.txt",
  "commands_run.txt",
  "test_output.txt",
  "build_output.txt",
  "phase_1_notes.md",
  "files_changed.txt",
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
  fs.writeFileSync(path.join(evidenceDir, "zip_verification.txt"), lines.join("\n"), "utf8");
  process.exit(1);
}

// Extract-test into a temp folder using PowerShell Expand-Archive.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "crmfeed-zip-verify-"));
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

  // Find required files anywhere in the extracted tree (basename match).
  const basenames = allFiles.map((f) => path.basename(f));
  const present = required.filter((r) => basenames.includes(r));
  const missing = required.filter((r) => !basenames.includes(r));

  log("Required files present:");
  for (const r of present) log(`  OK   ${r}`);
  if (missing.length > 0) {
    log("Required files MISSING:");
    for (const r of missing) log(`  MISS ${r}`);
  }

  const pass = missing.length === 0;
  log(`RESULT: ${pass ? "PASS" : "FAIL"}`);

  fs.writeFileSync(path.join(evidenceDir, "zip_verification.txt"), lines.join("\n"), "utf8");
  process.exit(pass ? 0 : 1);
} catch (e) {
  const msg = (e && e.message) ? e.message : String(e);
  log(`RESULT: FAIL (extraction error: ${msg})`);
  fs.writeFileSync(path.join(evidenceDir, "zip_verification.txt"), lines.join("\n"), "utf8");
  process.exit(1);
} finally {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
}
