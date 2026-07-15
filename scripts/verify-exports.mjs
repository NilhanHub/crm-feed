// Export verification script — independently verifies that all export bundles
// in data/exports/ are internally consistent, company-scoped, latest-approved
// only, and contain no vague-mutual-only people.
//
// Usage: node scripts/verify-exports.mjs
import fs from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const EXPORTS = path.join(REPO_ROOT, "data", "exports");

console.log("=== Export Verification ===");
console.log(`Date: ${new Date().toISOString()}`);

const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok, detail });
  console.log(`  ${ok ? "PASS" : "FAIL"} — ${name}${detail ? `: ${detail}` : ""}`);
}

if (!fs.existsSync(EXPORTS)) {
  console.log("\nNo exports directory found.");
  console.log("RESULT: PASS (no exports to verify)");
  process.exit(0);
}

// Find all manifest files
const manifestFiles = fs.readdirSync(EXPORTS).filter((f) => f.endsWith("__manifest.json"));

if (manifestFiles.length === 0) {
  console.log("\nNo export manifests found.");
  console.log("RESULT: PASS (no exports to verify)");
  process.exit(0);
}

console.log(`Found ${manifestFiles.length} export manifest(s).\n`);

let totalIssues = 0;

for (const mf of manifestFiles) {
  const manifestPath = path.join(EXPORTS, mf);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const group = `Export ${manifest.exportId}`;

  // 1. Manifest references existing JSON + CSV files
  const jsonPath = path.join(EXPORTS, path.basename(manifest.paths.json));
  const csvPath = path.join(EXPORTS, path.basename(manifest.paths.csv));
  check(`${group}: JSON file exists`, fs.existsSync(jsonPath));
  check(`${group}: CSV file exists`, fs.existsSync(csvPath));

  // 2. Manifest parseable + has required fields
  check(`${group}: manifest has exportId`, Boolean(manifest.exportId));
  check(`${group}: manifest has companyId`, Boolean(manifest.companyId));
  check(`${group}: manifest has rulesVersion`, Boolean(manifest.rulesVersion));
  check(`${group}: manifest has liveCrmSync=false`, manifest.liveCrmSync === false);

  // 3. Read the JSON export and verify internal consistency
  if (fs.existsSync(jsonPath)) {
    const exportBundle = JSON.parse(fs.readFileSync(jsonPath, "utf8"));

    // Company scoping: all records belong to the same company
    const companies = new Set(exportBundle.records.map((r) => r.companyId));
    check(`${group}: all records same company`, companies.size === 1,
      companies.size === 1 ? [...companies][0] : `${companies.size} companies`);

    // All records approved
    const nonApproved = exportBundle.records.filter((r) => r.reviewStatus !== "approved");
    check(`${group}: all records approved (latest)`, nonApproved.length === 0,
      nonApproved.length === 0 ? "" : `${nonApproved.length} not approved`);

    // No vague-mutual-only people (all should have namedMutuals)
    const noMutuals = exportBundle.records.filter((r) => !r.namedMutuals || r.namedMutuals.length === 0);
    check(`${group}: no vague-mutual-only people`, noMutuals.length === 0,
      noMutuals.length === 0 ? "" : `${noMutuals.length} without named mutuals`);

    // Record count matches manifest
    check(`${group}: record count matches manifest`, exportBundle.recordCount === manifest.recordCount,
      `${exportBundle.recordCount} vs ${manifest.recordCount}`);

    // Max 10 people cap
    check(`${group}: within 10-person cap`, exportBundle.records.length <= 10,
      `${exportBundle.records.length} records`);

    // liveCrmSync flag on bundle
    check(`${group}: bundle has liveCrmSync=false`, exportBundle.liveCrmSync === false);
  }

  // 4. File hashes match manifest
  if (manifest.fileHashes && fs.existsSync(jsonPath) && fs.existsSync(csvPath)) {
    const { createHash } = await import("node:crypto");
    const jsonSha = createHash("sha256").update(fs.readFileSync(jsonPath)).digest("hex");
    const csvSha = createHash("sha256").update(fs.readFileSync(csvPath)).digest("hex");
    check(`${group}: JSON hash matches manifest`, jsonSha === manifest.fileHashes.json.sha256);
    check(`${group}: CSV hash matches manifest`, csvSha === manifest.fileHashes.csv.sha256);
  }
}

const failed = checks.filter((c) => !c.ok);
console.log(`\n=== Summary ===`);
console.log(`Checks: ${checks.length} | Passed: ${checks.length - failed.length} | Failed: ${failed.length}`);
if (failed.length > 0) {
  for (const c of failed) console.log(`  FAILED: ${c.name}`);
  console.log("RESULT: FAIL");
  process.exit(1);
}
console.log("RESULT: PASS — all exports verified.");
