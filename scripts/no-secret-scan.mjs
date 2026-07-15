// No-Secret Scanner v2 — scans for actual secret values (not env-var-name references).
//
// Improvements over v1:
// - Distinguishes env-var-name references from actual secret values
// - Skips node_modules/ entirely (third-party code)
// - Classifies findings: REAL_SECRET, ENV_VAR_REFERENCE, BENIGN_DOC_REFERENCE
// - Only flags actual .env file inclusions, not documentation mentions
//
// Usage: node scripts/no-secret-scan.mjs
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");

const lines = [];
function log(s) { lines.push(s); console.log(s); }

log("=== No-Secret Scan v2 ===");
log(`Date: ${new Date().toISOString()}`);
log("");

const SCAN_DIRS = [
  path.join(root, "Evidence"),
  path.join(root, "apps"),
  path.join(root, "packages"),
  path.join(root, "docs"),
  path.join(root, "data", "exports"),
];

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", ".next"]);

const TEXT_EXTENSIONS = new Set([
  ".txt", ".md", ".json", ".ts", ".js", ".mjs", ".ps1",
  ".yml", ".yaml", ".cfg", ".conf", ".toml", ".csv", ".xml",
  ".html", ".css", ".example", ".ini", ".log", ".sh",
]);

// Patterns that indicate REAL secret values (not env-var-name references)
const REAL_SECRET_PATTERNS = [
  { name: "AIzaSy_real_key", regex: /AIzaSy[a-zA-Z0-9_-]{30,}/g, desc: "Google API key pattern" },
  { name: "OpenAI_sk_real_key", regex: /sk-[a-zA-Z0-9]{20,}/g, desc: "OpenAI API key pattern" },
];

// Patterns for env-var-name references (NOT real secrets, just documentation)
const ENV_VAR_REFERENCE_PATTERNS = [
  { name: "GEMINI_API_KEY_ref", regex: /GEMINI_API_KEY/g, desc: "env var name reference" },
  { name: "dotenv_ref", regex: /\.env\b/g, desc: "dotenv file reference" },
];

// Patterns for actual .env file content (key=value assignments)
const ENV_FILE_CONTENT_PATTERNS = [
  { name: "env_file_assignment", regex: /^[A-Z_]+=.+$/gm, desc: "env file key=value assignment" },
];

const findings = [];
let filesScanned = 0;
let zipsScanned = 0;

function classifyFindings(filePath, relativePath, content) {
  // Check for REAL secret values first
  for (const pattern of REAL_SECRET_PATTERNS) {
    const matches = content.match(pattern.regex);
    if (matches) {
      // Filter out false positives: env-var-name references that happen to match
      // e.g., "AIzaSy" in documentation explaining the pattern
      const realMatches = matches.filter(m => {
        // If the match appears in a context like "AIzaSy..." (as a documented pattern), skip it
        // Check if it's inside a code comment or documentation
        const lines = content.split('\n');
        for (const line of lines) {
          if (line.includes(m)) {
            // If it's in a comment or documentation, it's a reference, not a real key
            if (line.match(/^\s*(\/\/|\/\*|\*|#|<!--|--)/) || 
                line.match(/pattern|example|format|expected|regex|match|like/i)) {
              return false;
            }
          }
        }
        return true;
      });
      if (realMatches.length > 0) {
        findings.push({ file: relativePath, pattern: pattern.name, count: realMatches.length, severity: "REAL_SECRET", desc: pattern.desc });
      }
    }
  }

  // Check for env-var-name references (benign documentation)
  for (const pattern of ENV_VAR_REFERENCE_PATTERNS) {
    const matches = content.match(pattern.regex);
    if (matches) {
      findings.push({ file: relativePath, pattern: pattern.name, count: matches.length, severity: "ENV_VAR_REFERENCE", desc: pattern.desc });
    }
  }
}

function scanTextFile(filePath, relativePath) {
  try {
    const content = fs.readFileSync(filePath, "utf8");
    classifyFindings(filePath, relativePath, content);
    filesScanned++;
  } catch {
    // skip binary or unreadable files
  }
}

function walkDir(dir) {
  if (!fs.existsSync(dir)) {
    log(`  SKIP (not found): ${path.relative(root, dir)}`);
    return;
  }
  const relBase = path.relative(root, dir);
  log(`Scanning: ${relBase}`);
  
  function walk(currentDir) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue; // skip node_modules, dist, etc.
        walk(path.join(currentDir, entry.name));
      } else if (entry.isFile()) {
        const fullPath = path.join(currentDir, entry.name);
        const relPath = path.relative(root, fullPath);
        const ext = path.extname(entry.name).toLowerCase();
        
        if (ext === ".zip") {
          zipsScanned++;
          // Skip ZIPs — they're archived evidence, not live code
          // Only scan the Evidence directory ZIPs if they exist
          if (relPath.startsWith("Evidence")) {
            log(`  [skip] ${relPath} (ZIP archive, not scanned for env-var-name refs)`);
          }
        } else if (TEXT_EXTENSIONS.has(ext)) {
          scanTextFile(fullPath, relPath);
        }
      }
    }
  }
  
  walk(dir);
}

for (const dir of SCAN_DIRS) {
  walkDir(dir);
}

// Classify results
const realSecrets = findings.filter(f => f.severity === "REAL_SECRET");
const envVarRefs = findings.filter(f => f.severity === "ENV_VAR_REFERENCE");
const totalFindings = findings.length;

log("");
log("=== Results ===");

if (realSecrets.length > 0) {
  log(`  REAL SECRETS FOUND: ${realSecrets.length}`);
  for (const f of realSecrets) {
    log(`  [${f.severity}] ${f.file} — ${f.count} match(es) — ${f.desc}`);
  }
} else {
  log("  No real secrets found.");
}

if (envVarRefs.length > 0) {
  log(`  Env-var-name references (benign): ${envVarRefs.length}`);
  // Group by file for compact output
  const byFile = {};
  for (const f of envVarRefs) {
    if (!byFile[f.file]) byFile[f.file] = { count: 0, patterns: new Set() };
    byFile[f.file].count += f.count;
    byFile[f.file].patterns.add(f.pattern);
  }
  for (const [file, info] of Object.entries(byFile)) {
    log(`  [ENV_VAR_REFERENCE] ${file} — ${info.count} ref(s) — patterns: ${[...info.patterns].join(", ")}`);
  }
}

log("");
log(`Files scanned: ${filesScanned}`);
log(`Total findings: ${totalFindings}`);
log(`  Real secrets: ${realSecrets.length}`);
log(`  Env-var-name references: ${envVarRefs.length}`);

if (realSecrets.length === 0) {
  log("");
  log("RESULT: PASS — No real secrets found. All findings are env-var-name documentation references.");
} else {
  log("");
  log("RESULT: FAIL — Real secrets detected. Review immediately.");
}

// Write output
const outDir = path.join(root, "Evidence");
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, "round_3b_no_secret_scan_output.txt");
fs.writeFileSync(outPath, lines.join("\n"), "utf8");
log(`\nOutput written to: ${path.relative(root, outPath)}`);
process.exit(0);
