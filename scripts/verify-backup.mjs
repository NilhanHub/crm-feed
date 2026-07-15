// Backup verification script — checks that a backup exists, is non-empty,
// contains expected folders/files, has a readable manifest, and has no
// forbidden files.
//
// Usage: node scripts/verify-backup.mjs [backupId]
//   If backupId is omitted, verifies the most recent backup in data/backups.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const BACKUPS = path.join(REPO_ROOT, "data", "backups");

function sha256OfFile(p) {
  const buf = fs.readFileSync(p);
  return createHash("sha256").update(buf).digest("hex");
}

function walk(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(full));
    else if (e.isFile()) out.push(full);
  }
  return out;
}

function listBackups() {
  if (!fs.existsSync(BACKUPS)) return [];
  return fs.readdirSync(BACKUPS, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.startsWith("backup_"))
    .map((e) => e.name)
    .sort()
    .reverse();
}

const argBackupId = process.argv[2];
const backups = listBackups();

let backupId;
if (argBackupId) {
  backupId = argBackupId.startsWith("backup_") ? argBackupId : `backup_${argBackupId}`;
  if (!backups.includes(backupId)) {
    console.error(`Backup not found: ${backupId}`);
    process.exit(1);
  }
} else {
  if (backups.length === 0) {
    console.error("No backups found in data/backups");
    process.exit(1);
  }
  backupId = backups[0];
}

const backupDir = path.join(BACKUPS, backupId);
const manifestPath = path.join(backupDir, "__backup_manifest.json");

console.log(`=== Backup Verification ===`);
console.log(`Backup ID: ${backupId}`);
console.log(`Path: ${path.relative(REPO_ROOT, backupDir)}`);

const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok, detail });
  console.log(`  ${ok ? "PASS" : "FAIL"} — ${name}${detail ? `: ${detail}` : ""}`);
}

// 1. Exists
const exists = fs.existsSync(backupDir);
check("backup directory exists", exists);
if (!exists) { console.log("\nRESULT: FAIL"); process.exit(1); }

// 2. Non-zero size
const allFiles = walk(backupDir);
const sizeBytes = allFiles.reduce((sum, f) => sum + fs.statSync(f).size, 0);
check("backup non-zero size", sizeBytes > 0, `${sizeBytes} bytes`);

// 3. Manifest readable
check("manifest file present", fs.existsSync(manifestPath));
let manifest;
if (fs.existsSync(manifestPath)) {
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    check("manifest parseable", true);
  } catch (err) {
    check("manifest parseable", false, err.message);
  }
} else {
  check("manifest parseable", false, "no manifest");
}

// 4. Expected data folders present
for (const d of ["db", "uploads", "exports"]) {
  const inData = path.join(backupDir, "data", d);
  const atRoot = path.join(backupDir, d);
  check(`${d}/ folder present`, fs.existsSync(inData) || fs.existsSync(atRoot), d);
}

// 5. No forbidden files
const forbidden = allFiles.filter((f) =>
  f.includes("node_modules") ||
  f.includes(`${path.sep}dist${path.sep}`) ||
  f.endsWith(".env") ||
  f.includes(`${path.sep}.git${path.sep}`) ||
  f.endsWith(`${path.sep}.git`)
);
check("no forbidden files (node_modules/dist/.env/.git)", forbidden.length === 0,
  forbidden.length === 0 ? "" : `${forbidden.length} forbidden`);

// 6. Manifest entry hashes match files
if (manifest && manifest.entries) {
  let hashMismatches = 0;
  for (const entry of manifest.entries) {
    const fp = path.join(backupDir, entry.path);
    if (!fs.existsSync(fp)) { hashMismatches++; continue; }
    if (sha256OfFile(fp) !== entry.sha256) hashMismatches++;
  }
  check("manifest hashes match files", hashMismatches === 0,
    hashMismatches === 0 ? `${manifest.entries.length} verified` : `${hashMismatches} mismatches`);
  check("manifest totalFiles matches entries", manifest.totalFiles === manifest.entries.length,
    `${manifest.totalFiles} vs ${manifest.entries.length}`);
}

const failed = checks.filter((c) => !c.ok);
console.log(`\n=== Summary ===`);
console.log(`Checks: ${checks.length} | Passed: ${checks.length - failed.length} | Failed: ${failed.length}`);
if (failed.length > 0) {
  console.log("RESULT: FAIL");
  process.exit(1);
}
console.log("RESULT: PASS — backup is valid and complete.");
