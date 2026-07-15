// Local backup script — backs up data/db, data/uploads, data/exports, and key
// manifest/config files into a timestamped folder under data/backups with a
// backup manifest (counts + sha256 + sizes). Excludes secrets, node_modules,
// dist, .git, .env, and old backups.
//
// Usage: node scripts/backup-data.mjs
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

// Version metadata (kept in sync with packages/shared/src/rules/version.ts).
// The backup script reads these directly to avoid a TS build step.
const RULES_VERSION = "4.0.0";
const APP_VERSION = "0.4.0";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const DATA = path.join(REPO_ROOT, "data");
const BACKUPS = path.join(DATA, "backups");

const SOURCE_DIRS = ["db", "uploads", "exports"];
const EXTRA_FILES = [".env.example", ".gitignore", "package.json"];

function sha256OfFile(p) {
  const buf = fs.readFileSync(p);
  return createHash("sha256").update(buf).digest("hex");
}

function walkDir(dir, base = dir) {
  const entries = [];
  if (!fs.existsSync(dir)) return entries;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      entries.push(...walkDir(full, base));
    } else if (entry.isFile()) {
      entries.push(full);
    }
  }
  return entries;
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupId = `backup_${stamp}`;
const backupDir = path.join(BACKUPS, backupId);
fs.mkdirSync(backupDir, { recursive: true });

const entries = [];
let totalBytes = 0;

// Copy source data directories
for (const sub of SOURCE_DIRS) {
  const src = path.join(DATA, sub);
  const files = walkDir(src);
  for (const file of files) {
    const rel = path.relative(DATA, file).replace(/\\/g, "/");
    // Skip forbidden patterns just in case
    if (rel.includes("node_modules") || rel.includes("/dist/") || rel.endsWith(".env")) continue;
    const dest = path.join(backupDir, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(file, dest);
    const stat = fs.statSync(dest);
    const sha = sha256OfFile(dest);
    entries.push({ path: rel, sizeBytes: stat.size, sha256: sha });
    totalBytes += stat.size;
  }
}

// Copy extra manifest/config files
for (const fname of EXTRA_FILES) {
  const src = path.join(REPO_ROOT, fname);
  if (!fs.existsSync(src)) continue;
  const rel = fname;
  const dest = path.join(backupDir, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  const stat = fs.statSync(dest);
  const sha = sha256OfFile(dest);
  entries.push({ path: rel, sizeBytes: stat.size, sha256: sha });
  totalBytes += stat.size;
}

const manifest = {
  backupId,
  createdAt: new Date().toISOString(),
  appVersion: APP_VERSION,
  rulesVersion: RULES_VERSION,
  entries,
  totalFiles: entries.length,
  totalBytes,
  note: "Local backup of data/db, data/uploads, data/exports + key config. No secrets, no node_modules, no dist, no .git.",
};

// Write manifest inside the backup folder (not inside the app data)
fs.writeFileSync(path.join(backupDir, "__backup_manifest.json"), JSON.stringify(manifest, null, 2), "utf8");

// Also write manifest to the backups root for easy access
fs.writeFileSync(path.join(BACKUPS, `${backupId}__manifest.json`), JSON.stringify(manifest, null, 2), "utf8");

console.log(`Backup created: ${path.relative(REPO_ROOT, backupDir)}`);
console.log(`Files: ${entries.length} | Total size: ${totalBytes} bytes`);
console.log(`Manifest: ${path.relative(REPO_ROOT, path.join(backupDir, "__backup_manifest.json"))}`);
console.log(`Backup ID: ${backupId}`);
