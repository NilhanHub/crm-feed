import { Router } from "express";
import { execSync } from "node:child_process";
import {
  PATHS,
  GEMINI_CONFIG,
  geminiConfigured,
  NODE_ENV,
  dirWritable,
  dirReadable,
} from "../config.js";
import { getAppVersion, RULES_VERSION, EXTRACTION_SCHEMA_VERSION, GEMINI_PROMPT_VERSION } from "@crm-feed/shared";
import { companies, batches, extractedPeople, reviewDecisions, exportBatches, extractionAttempts } from "../store/db.js";

export const healthRouter = Router();

function getAppCommit(): string | undefined {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  } catch {
    return undefined;
  }
}

async function dbReadable(): Promise<boolean> {
  try {
    // Read one collection to confirm the DB path is readable.
    await companies.all();
    return true;
  } catch {
    return false;
  }
}

healthRouter.get("/", async (_req, res) => {
  // Last integrity check status (best-effort from env; the integrity script
  // writes results to Evidence/, not to a runtime file the app reads).
  const lastIntegrityCheckStatus = process.env.LAST_INTEGRITY_CHECK_STATUS ?? "unknown";

  const [dbOk, companyCount, batchCount, peopleCount, reviewCount, exportCount, attemptCount] = await Promise.all([
    dbReadable(),
    companies.all().then((r) => r.length).catch(() => -1),
    batches.all().then((r) => r.length).catch(() => -1),
    extractedPeople.all().then((r) => r.length).catch(() => -1),
    reviewDecisions.all().then((r) => r.length).catch(() => -1),
    exportBatches.all().then((r) => r.length).catch(() => -1),
    extractionAttempts.all().then((r) => r.length).catch(() => -1),
  ]);

  const geminiReady = geminiConfigured();

  res.json({
    status: "ok",
    service: "crm-feed-api",
    time: new Date().toISOString(),
    // Versions
    appVersion: getAppVersion(),
    appCommit: getAppCommit(),
    rulesVersion: RULES_VERSION,
    extractionSchemaVersion: EXTRACTION_SCHEMA_VERSION,
    geminiPromptVersion: GEMINI_PROMPT_VERSION,
    // Environment
    environment: NODE_ENV,
    deploymentMode: "local-first",
    deployedToCloud: false,
    // Gemini — configured yes/no without exposing the key
    gemini: {
      configured: geminiReady,
      status: geminiReady ? "available" : "pending_credentials",
      model: GEMINI_CONFIG.model,
      keyPresent: geminiReady, // boolean only, never the value
    },
    // Storage diagnostics
    storage: {
      uploads: { path: "data/uploads", readable: dirReadable(PATHS.uploads), writable: dirWritable(PATHS.uploads) },
      db: { path: "data/db", readable: dirReadable(PATHS.db), writable: dirWritable(PATHS.db), readableOk: dbOk },
      exports: { path: "data/exports", readable: dirReadable(PATHS.exports), writable: dirWritable(PATHS.exports) },
      backups: { path: "data/backups", readable: dirReadable(PATHS.backups), writable: dirWritable(PATHS.backups) },
    },
    // DB record counts (sanity)
    counts: {
      companies: companyCount,
      batches: batchCount,
      extractedPeople: peopleCount,
      reviewDecisions: reviewCount,
      exportBatches: exportCount,
      extractionAttempts: attemptCount,
    },
    lastIntegrityCheckStatus,
    persistence: "atomic-json (local dev)",
  });
});
