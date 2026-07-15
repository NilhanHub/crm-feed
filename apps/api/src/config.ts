import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Resolve repo root from compiled dist/config.js location.
 * dist/ -> api/ -> repo root. Supports CRM_FEED_APP_ROOT override.
 */
/**
 * Walk up from startDir looking for the repo root (has package.json with "workspaces").
 */
function walkUpToRoot(startDir: string): string | null {
  let dir = startDir;
  for (let i = 0; i < 10; i++) {
    const pkgPath = path.join(dir, "package.json");
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
        if (pkg.workspaces) return dir;
      } catch { /* not a valid package.json */ }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function resolveRepoRoot(): string {
  if (process.env.CRM_FEED_APP_ROOT) return path.resolve(process.env.CRM_FEED_APP_ROOT);
  {
    const scriptDir = path.dirname(fileURLToPath(import.meta.url));
    const fromScript = walkUpToRoot(scriptDir);
    if (fromScript) return fromScript;
  }
  const fromCwd = walkUpToRoot(process.cwd());
  if (fromCwd) return fromCwd;
  return path.resolve(process.cwd(), "../..");
}

const REPO_ROOT = resolveRepoRoot();

function ensureDir(p: string): string {
  fs.mkdirSync(p, { recursive: true });
  return p;
}

export const PATHS = {
  repoRoot: REPO_ROOT,
  uploads: ensureDir(path.join(REPO_ROOT, "data", "uploads")),
  db: ensureDir(path.join(REPO_ROOT, "data", "db")),
  exports: ensureDir(path.join(REPO_ROOT, "data", "exports")),
  backups: ensureDir(path.join(REPO_ROOT, "data", "backups")),
};

export const PORT = Number(process.env.PORT ?? 8787);
export const WEB_ORIGIN = process.env.WEB_ORIGIN ?? "http://localhost:5173";

// Environment mode — distinguishes local dev from production deployments.
// The app is local-first; NODE_ENV is informational, not behavioural, for now.
export const NODE_ENV = process.env.NODE_ENV ?? "development";
export const IS_PRODUCTION = NODE_ENV === "production";

// Gemini configuration. The API key is read ONLY from the environment and is
// never logged, persisted to JSON, or returned by any endpoint. A missing key
// is a normal "pending credentials" state, not a fatal error.
export const GEMINI_CONFIG = {
  apiKey: process.env.GEMINI_API_KEY ?? "",
  googleApplicationCredentials: process.env.GOOGLE_APPLICATION_CREDENTIALS ?? "",
  model: process.env.GEMINI_MODEL ?? "gemini-2.0-flash",
  maxRetries: Number(process.env.GEMINI_MAX_RETRIES ?? 2),
  timeoutMs: Number(process.env.GEMINI_TIMEOUT_MS ?? 60000),
};

export function geminiConfigured(): boolean {
  return Boolean(GEMINI_CONFIG.apiKey || GEMINI_CONFIG.googleApplicationCredentials);
}

/** Safe storage-check helpers used by the health endpoint. Never expose secrets. */
export function dirWritable(p: string): boolean {
  try {
    fs.accessSync(p, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

export function dirReadable(p: string): boolean {
  try {
    fs.accessSync(p, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}
