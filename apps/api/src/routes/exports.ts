import { Router } from "express";
import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import {
  companies,
  extractedPeople,
  reviewDecisions,
  mutualContacts,
  eligibilityDecisions,
  screenshots,
  batches,
  extractionRuns,
  crmSyncRecords,
  exportBatches,
} from "../store/db.js";
import { PATHS } from "../config.js";
import { newId, nowIso } from "../util/id.js";
import { writeAudit } from "../audit/writer.js";
import { createHash } from "node:crypto";
import {
  projectLatestReviewStates,
  isLatestApproved,
  evaluateEligibility,
  dedupePeople,
  rankPeople,
  MAX_PEOPLE_PER_EMAIL,
  MAX_NAMED_MUTUALS_PER_PERSON,
  RULES_VERSION,
  EXTRACTION_SCHEMA_VERSION,
  getAppVersion,
  type ExtractionPerson,
  type ExtractedPerson,
} from "@crm-feed/shared";

export const exportsRouter = Router();

const CreateExportSchema = z.object({
  companyId: z.string().min(1),
});

// Reconstruct the schema-shaped ExtractionPerson from stored entities.
function toExtractionPersonShape(
  entity: ExtractedPerson,
  mutuals: { name: string; excludedFromEmail: boolean; vagueCount?: number }[]
): ExtractionPerson {
  const named = mutuals
    .filter((m) => !m.excludedFromEmail && m.name !== "__vague_count__")
    .map((m) => ({ name: m.name }));
  const vague = mutuals.find((m) => m.excludedFromEmail && m.name === "__vague_count__");
  return {
    personId: entity.id,
    name: entity.name,
    headline: entity.headline ?? null,
    title: entity.title ?? null,
    location: entity.location ?? null,
    connectionDegree: entity.connectionDegree ?? "unknown",
    currentRoles: entity.currentRoles,
    pastRoles: entity.pastRoles,
    mutualContacts: {
      named,
      vagueCount: vague?.vagueCount ?? null,
    },
    sourceScreenshotIds: entity.sourceScreenshotIds,
    confidence: entity.confidence,
  };
}

function getAppCommit(): string | undefined {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  } catch {
    return undefined;
  }
}

exportsRouter.post("/", async (req, res) => {
  const parsed = CreateExportSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_export_request", detail: parsed.error.toString() });
  }
  const company = await companies.get(parsed.data.companyId);
  if (!company) return res.status(404).json({ error: "company_not_found" });

  const allPeople = await extractedPeople.all();
  const allReviews = await reviewDecisions.all();
  const allMutuals = await mutualContacts.all();
  const allElig = await eligibilityDecisions.all();
  const allShots = await screenshots.all();
  const allBatches = await batches.all();
  const allRuns = await extractionRuns.all();

  // FIX (Round 1 bug B): Company-scoped — only people belonging to THIS company.
  const companyPeople = allPeople.filter((p) => p.companyId === company.id);

  // FIX (Round 1 bug C): Latest review state only.
  const reviewStates = projectLatestReviewStates(allReviews);

  // Filter: latest approved + currently at target + has named mutual
  const reconstructed = companyPeople.map((p) => {
    const pmutuals = allMutuals
      .filter((m) => m.extractedPersonId === p.id)
      .map((m) => ({ name: m.name, excludedFromEmail: m.excludedFromEmail, vagueCount: m.vagueCount }));
    return toExtractionPersonShape(p, pmutuals);
  });

  const { unique } = dedupePeople(reconstructed, company.name);
  const eligibleApproved = unique.filter((person) => {
    const state = reviewStates.get(person.personId);
    if (!isLatestApproved(state)) return false;
    const elig = evaluateEligibility({ person, targetCompanyName: company.name });
    return elig.eligible;
  });

  const ranked = rankPeople(eligibleApproved).slice(0, MAX_PEOPLE_PER_EMAIL);

  if (ranked.length === 0) {
    return res.status(400).json({ error: "no_approved_people", detail: "No approved eligible people to export for this company" });
  }

  const exportId = newId("exp");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const baseName = `export_${company.id}_${stamp}_${exportId}`;
  const jsonPath = path.join(PATHS.exports, `${baseName}.json`);
  const csvPath = path.join(PATHS.exports, `${baseName}.csv`);
  const manifestPath = path.join(PATHS.exports, `${baseName}__manifest.json`);

  const appVersion = getAppVersion();
  const appCommit = getAppCommit();

  const records = ranked.map((scored) => {
    const person = scored.person;
    const entity = companyPeople.find((p) => p.id === person.personId)!;
    const state = reviewStates.get(person.personId)!;
    const elig = allElig.find((e) => e.extractedPersonId === person.personId) ?? null;
    const namedMutuals = allMutuals
      .filter((m) => m.extractedPersonId === person.personId && !m.excludedFromEmail && m.name !== "__vague_count__")
      .map((m) => m.name)
      .slice(0, MAX_NAMED_MUTUALS_PER_PERSON);
    const run = allRuns.find((r) => r.id === entity.extractionRunId) ?? null;
    const batch = run ? allBatches.find((b) => b.id === run.batchId) ?? null : null;
    const sourceShots = allShots.filter((s) => person.sourceScreenshotIds.includes(s.id));
    return {
      extractedPersonId: person.personId,
      companyId: company.id,
      companyName: company.name,
      name: person.name,
      title: person.title ?? person.headline ?? null,
      location: person.location ?? null,
      currentRoles: person.currentRoles,
      eligible: elig?.eligible ?? true,
      eligibilityReasons: elig?.reasons ?? [],
      rankScore: scored.score,
      rankTier: scored.tier,
      namedMutuals,
      reviewStatus: state.latestDecision,
      reviewNote: state.latestNote,
      reviewedBy: state.latestReviewedBy,
      reviewedAt: state.latestDecidedAt,
      provenance: {
        extractionRunId: entity.extractionRunId,
        batchId: batch?.id ?? null,
        sourceScreenshots: sourceShots.map((s) => ({
          id: s.id,
          originalFilename: s.originalFilename,
          sha256: s.sha256,
          storagePath: s.storagePath,
        })),
      },
    };
  });

  // JSON export (full structured data)
  const exportBundle = {
    exportId,
    exportedAt: nowIso(),
    company: { id: company.id, name: company.name },
    crmSyncPolicy: "export_contract_no_live_crm",
    liveCrmSync: false,
    rulesVersion: RULES_VERSION,
    extractionSchemaVersion: EXTRACTION_SCHEMA_VERSION,
    appVersion,
    appCommit,
    recordCount: records.length,
    approvedPersonIds: records.map((r) => r.extractedPersonId),
    sourceReviewStateBasis: "latest_approved_only",
    records,
  };
  fs.writeFileSync(jsonPath, JSON.stringify(exportBundle, null, 2), "utf8");

  // CSV export (CRM-ready flat fields, including source screenshot IDs and review status)
  const csvHeader = "companyName,personName,title,location,currentRole,namedMutuals,sourceScreenshotIds,reviewStatus,exportGeneratedDate";
  const csvRows = records.map((r) => {
    const current = r.currentRoles[0];
    const currentText = current ? `${current.title} at ${current.company}` : "";
    const mutuals = r.namedMutuals.join("; ");
    const shotIds = r.provenance.sourceScreenshots.map((s) => s.id).join("; ");
    return [r.companyName, r.name, r.title ?? "", r.location ?? "", currentText, mutuals, shotIds, r.reviewStatus, exportBundle.exportedAt]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`)
      .join(",");
  });
  fs.writeFileSync(csvPath, [csvHeader, ...csvRows].join("\n"), "utf8");

  // Manifest (provenance + integrity) — includes file hashes/sizes and explicit no-live-sync flag.
  const jsonStat = fs.statSync(jsonPath);
  const csvStat = fs.statSync(csvPath);
  const jsonSha = createHash("sha256").update(fs.readFileSync(jsonPath)).digest("hex");
  const csvSha = createHash("sha256").update(fs.readFileSync(csvPath)).digest("hex");
  const manifest = {
    exportId,
    paths: {
      json: path.relative(PATHS.repoRoot, jsonPath),
      csv: path.relative(PATHS.repoRoot, csvPath),
    },
    fileHashes: {
      json: { sha256: jsonSha, sizeBytes: jsonStat.size },
      csv: { sha256: csvSha, sizeBytes: csvStat.size },
    },
    recordCount: records.length,
    companyId: company.id,
    approvedPersonIds: records.map((r) => r.extractedPersonId),
    sourceReviewStateBasis: "latest_approved_only",
    liveCrmSync: false,
    rulesVersion: RULES_VERSION,
    extractionSchemaVersion: EXTRACTION_SCHEMA_VERSION,
    appVersion,
    appCommit,
    generatedAt: exportBundle.exportedAt,
    provenance: records.map((r) => ({
      extractedPersonId: r.extractedPersonId,
      sourceScreenshotIds: r.provenance.sourceScreenshots.map((s) => s.id),
      sha256Hashes: r.provenance.sourceScreenshots.map((s) => s.sha256),
    })),
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");

  // Durable export batch record
  const exportBatch = {
    id: exportId,
    companyId: company.id,
    companyName: company.name,
    includedPersonIds: records.map((r) => r.extractedPersonId),
    exportJsonPath: path.relative(PATHS.repoRoot, jsonPath),
    exportCsvPath: path.relative(PATHS.repoRoot, csvPath),
    manifestPath: path.relative(PATHS.repoRoot, manifestPath),
    recordCount: records.length,
    rulesVersion: RULES_VERSION,
    appVersion,
    status: "exported" as const,
    generatedAt: exportBundle.exportedAt,
  };
  await exportBatches.set(exportBatch);
  await writeAudit({
    eventType: "export_created",
    companyId: company.id,
    exportId,
    detail: `${records.length} record(s) exported to ${path.relative(PATHS.repoRoot, jsonPath)} (no live CRM sync)`,
  });

  // Create / update idempotent CrmSyncRecords (keyed on extractedPersonId + companyId)
  const existingSync = await crmSyncRecords.all();
  const syncRecords = [];
  for (const r of records) {
    const existing = existingSync.find(
      (s) => s.extractedPersonId === r.extractedPersonId && s.companyId === company.id
    );
    if (existing) {
      const updated = {
        ...existing,
        status: "exported" as const,
        exportPath: path.relative(PATHS.repoRoot, jsonPath),
        error: undefined,
      };
      await crmSyncRecords.set(updated);
      syncRecords.push(updated);
    } else {
      const sync = {
        id: newId("crm"),
        companyId: company.id,
        extractedPersonId: r.extractedPersonId,
        reviewDecisionId: reviewStates.get(r.extractedPersonId)?.latestReviewId ?? "",
        exportBatchId: exportId,
        status: "exported" as const,
        exportPath: path.relative(PATHS.repoRoot, jsonPath),
        createdAt: nowIso(),
      };
      await crmSyncRecords.set(sync);
      syncRecords.push(sync);
    }
  }

  res.status(201).json({
    exportId,
    company: { id: company.id, name: company.name },
    exportJson: path.relative(PATHS.repoRoot, jsonPath),
    exportCsv: path.relative(PATHS.repoRoot, csvPath),
    manifest: path.relative(PATHS.repoRoot, manifestPath),
    recordCount: records.length,
    rulesVersion: RULES_VERSION,
    crmSyncRecords: syncRecords,
    note: "Export contract written. No live CRM API configured; status is 'exported', not 'synced'.",
  });
});

// List export batches
exportsRouter.get("/", async (_req, res) => {
  res.json(await exportBatches.all());
});

// List export batches for a company
exportsRouter.get("/company/:companyId", async (req, res) => {
  const all = await exportBatches.all();
  res.json(all.filter((e) => e.companyId === req.params.companyId));
});

// Get a specific export batch
exportsRouter.get("/:id", async (req, res) => {
  const batch = await exportBatches.get(req.params.id);
  if (!batch) return res.status(404).json({ error: "not_found" });
  res.json(batch);
});
