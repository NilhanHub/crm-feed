import { Router } from "express";
import multer from "multer";
import { createHash } from "node:crypto";
import path from "node:path";
import fs from "node:fs";
import type { Screenshot } from "@crm-feed/shared";
import {
  companies, intakeBatches, batches, screenshots,
  extractionRuns, extractedPeople, mutualContacts,
  eligibilityDecisions,
} from "../store/db.js";
import { PATHS } from "../config.js";
import { newId, nowIso } from "../util/id.js";
import { writeAudit } from "../audit/writer.js";
import { fileExtractionObservations } from "../store/masterDbWriter.js";
import {
  inferCompany,
  findMatchingCompany,
  evaluateEligibility,
  normalizeCompanyName,
  type ExtractionPerson,
  type CompanyCandidate,
} from "@crm-feed/shared";

export const intakeRouter = Router();

const ALLOWED_MIME = new Set([
  "image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif",
]);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, PATHS.uploads),
  filename: (_req, file, cb) => {
    const id = newId("shot");
    const ext = path.extname(file.originalname) || ".png";
    cb(null, `${id}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME.has(file.mimetype)) return cb(null, true);
    cb(new Error(`unsupported_file_type: ${file.mimetype}`));
  },
});

function sha256OfFile(p: string): string {
  const buf = fs.readFileSync(p);
  return createHash("sha256").update(buf).digest("hex");
}

intakeRouter.post("/bulk-screenshots", upload.array("screenshots", 50), async (req, res) => {
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  if (files.length === 0) {
    return res.status(400).json({ error: "no_files_uploaded" });
  }

  const intakeId = newId("intake");
  const now = nowIso();
  const createdScreenshots: {
    id: string; originalFilename: string; storagePath: string;
    inferredCompanyId?: string; needsCompanyReview?: boolean;
    peopleCreated: number;
  }[] = [];

  let companiesCreated = 0;
  let companiesReused = 0;
  let peopleExtracted = 0;
  const errors: string[] = [];

  const allCompanies = await companies.all();

  await intakeBatches.set({
    id: intakeId,
    status: "processing",
    screenshotsReceived: files.length,
    screenshotsAssigned: 0,
    companiesCreated: 0,
    companiesReused: 0,
    unassignedCount: 0,
    peopleExtracted: 0,
    createdAt: now,
  });

  for (const file of files) {
    if (!file.path || !file.filename) continue;
    const sha = sha256OfFile(file.path);

    const shotId = newId("shot");
    const shot: Screenshot = {
      id: shotId,
      batchId: "__intake__",
      originalFilename: file.originalname,
      storedFilename: file.filename,
      storagePath: path.relative(PATHS.repoRoot, file.path).replace(/\\/g, "/"),
      mimeType: file.mimetype,
      sizeBytes: file.size,
      sha256: sha,
      intakeBatchId: intakeId,
      uploadedAt: now,
    };

    await screenshots.set(shot);
    await writeAudit({
      eventType: "intake_screenshot_uploaded",
      screenshotId: shotId,
      detail: `Intake ${intakeId}: ${shot.originalFilename}`,
    });

    let extractedPeopleForShot = 0;
    let companyCandidates: CompanyCandidate[] = [];
    let extractedPeopleData: ExtractionPerson[] = [];

    if (process.env.GEMINI_API_KEY) {
      try {
        const { GeminiExtractionProvider } = await import("../extraction/gemini.js");
        const provider = new GeminiExtractionProvider();
        const result = await provider.extract({
          screenshotPath: file.path,
          screenshotId: shotId,
          mimeType: file.mimetype,
          targetCompanyName: "",
          extractionRunId: "",
          batchId: "__intake__",
          companyId: "__intake__",
        });
        if (result.success && result.payload) {
          const people = result.payload.people ?? [];
          extractedPeopleForShot = people.length;
          extractedPeopleData = people;

          if (result.payload.screenshotCompanyInference?.targetCompanyCandidates) {
            companyCandidates = result.payload.screenshotCompanyInference.targetCompanyCandidates.map(
              (c: { name: string; signalType: string; mentionCount: number; evidenceText?: string }) => ({
                name: c.name,
                normalizedName: normalizeCompanyName(c.name),
                signalType: c.signalType as CompanyCandidate["signalType"],
                mentionCount: c.mentionCount,
                evidenceText: c.evidenceText,
              })
            );
          } else {
            const currentCompanies = new Map<string, number>();
            const pastCompanies = new Map<string, number>();
            for (const p of people) {
              for (const r of p.currentRoles ?? []) {
                const n = normalizeCompanyName(r.company);
                currentCompanies.set(n, (currentCompanies.get(n) ?? 0) + 1);
              }
              for (const r of p.pastRoles ?? []) {
                const n = normalizeCompanyName(r.company);
                pastCompanies.set(n, (pastCompanies.get(n) ?? 0) + 1);
              }
            }
            for (const [norm, count] of currentCompanies) {
              companyCandidates.push({ name: norm, normalizedName: norm, signalType: "current_role", mentionCount: count });
            }
            for (const [norm, count] of pastCompanies) {
              if (!currentCompanies.has(norm)) {
                companyCandidates.push({ name: norm, normalizedName: norm, signalType: "past_role", mentionCount: count });
              }
            }
          }
        }
      } catch (e) {
        errors.push(`Extraction failed for ${file.originalname}: ${(e as Error).message}`);
      }
    }

    const inference = inferCompany(companyCandidates);

    let assignedCompanyId: string | null = null;
    let needsReview = inference.needsReview;

    if (inference.dominantNormalized && !inference.needsReview) {
      const match = findMatchingCompany(allCompanies, inference.dominantNormalized);
      if (match) {
        assignedCompanyId = match.id;
        companiesReused++;
      } else {
        const companyId = newId("co");
        const newCompany = {
          id: companyId,
          name: inference.dominantCompanyName!,
          normalizedName: inference.dominantNormalized,
          aliases: companyCandidates.filter(c => c.normalizedName === inference.dominantNormalized).map(c => c.name),
          autoCreated: true,
          inferenceConfidence: inference.confidence,
          createdAt: now,
          updatedAt: now,
        };
        await companies.set(newCompany);
        allCompanies.push(newCompany);
        assignedCompanyId = companyId;
        companiesCreated++;

        await writeAudit({
          eventType: "company_auto_created",
          companyId,
          detail: `Auto-created from intake ${intakeId}: "${inference.dominantCompanyName!}" (confidence ${Math.round(inference.confidence * 100)}%)`,
        });
      }

      const batchId = newId("batch");
      await batches.set({
        id: batchId,
        companyId: assignedCompanyId,
        label: `Intake ${intakeId.slice(0, 12)}…`,
        status: "open",
        createdAt: now,
        updatedAt: now,
      });

      shot.batchId = batchId;
      shot.inferredCompanyId = assignedCompanyId;
      shot.inferenceConfidence = inference.confidence;
      shot.needsCompanyReview = false;
      await screenshots.set(shot);

      if (extractedPeopleForShot > 0 && extractedPeopleData.length > 0) {
        const runId = newId("run");
        await extractionRuns.set({
          id: runId,
          batchId,
          status: "review_ready",
          provider: "gemini",
          createdAt: now,
          updatedAt: now,
        });

        const intakeCreatedPeople: import("@crm-feed/shared").ExtractedPerson[] = [];
        const intakeCreatedMutualsMap = new Map<string, import("@crm-feed/shared").MutualContact[]>();

        for (const personData of extractedPeopleData) {
          const personId = newId("person");
          const ep: import("@crm-feed/shared").ExtractedPerson = {
            id: personId,
            extractionRunId: runId,
            companyId: assignedCompanyId,
            name: personData.name,
            headline: personData.headline ?? undefined,
            title: personData.title ?? undefined,
            location: personData.location ?? undefined,
            connectionDegree: personData.connectionDegree,
            currentRoles: personData.currentRoles ?? [],
            pastRoles: personData.pastRoles ?? [],
            currentlyAtTargetCompany: true,
            sourceScreenshotIds: [shotId],
            confidence: personData.confidence ?? 1,
            provenance: "gemini",
            createdAt: now,
          };
          await extractedPeople.set(ep);
          intakeCreatedPeople.push(ep);

          const personMutuals: import("@crm-feed/shared").MutualContact[] = [];
          for (const m of personData.mutualContacts?.named ?? []) {
            const mc: import("@crm-feed/shared").MutualContact = {
              id: newId("mut"),
              extractedPersonId: personId,
              name: m.name,
              headline: m.headline ?? undefined,
              excludedFromEmail: false,
              sourceScreenshotId: shotId,
            };
            await mutualContacts.set(mc);
            personMutuals.push(mc);
          }
          if (personData.mutualContacts?.vagueCount != null) {
            const mc: import("@crm-feed/shared").MutualContact = {
              id: newId("mut"),
              extractedPersonId: personId,
              name: "__vague_count__",
              excludedFromEmail: true,
              vagueCount: personData.mutualContacts.vagueCount,
              sourceScreenshotId: shotId,
            };
            await mutualContacts.set(mc);
            personMutuals.push(mc);
          }
          intakeCreatedMutualsMap.set(personId, personMutuals);

          const shape: ExtractionPerson = {
            personId,
            name: personData.name,
            headline: personData.headline ?? null,
            title: personData.title ?? null,
            location: personData.location ?? null,
            connectionDegree: personData.connectionDegree ?? "unknown",
            currentRoles: personData.currentRoles ?? [],
            pastRoles: personData.pastRoles ?? [],
            mutualContacts: personData.mutualContacts ?? { named: [], vagueCount: null },
            sourceScreenshotIds: [shotId],
            confidence: personData.confidence ?? 1,
          };
          const elig = evaluateEligibility({ person: shape, targetCompanyName: inference.dominantCompanyName! });
          await eligibilityDecisions.set({
            id: `elig_${personId}`,
            extractedPersonId: personId,
            eligible: elig.eligible,
            reasons: elig.reasons,
            computedAt: now,
          });

          peopleExtracted++;
        }

        // File observations
        await fileExtractionObservations(intakeCreatedPeople, intakeCreatedMutualsMap, shotId, runId);
      }
    } else {
      shot.needsCompanyReview = true;
      shot.inferenceConfidence = inference.confidence;
      if (inference.dominantNormalized) {
        shot.inferredCompanyId = "__unassigned__";
      }
      await screenshots.set(shot);
      needsReview = true;
    }

    createdScreenshots.push({
      id: shotId,
      originalFilename: file.originalname,
      storagePath: shot.storagePath,
      inferredCompanyId: assignedCompanyId ?? undefined,
      needsCompanyReview: needsReview,
      peopleCreated: extractedPeopleForShot,
    });
  }

  const assigned = createdScreenshots.filter(s => !s.needsCompanyReview);
  const unassigned = createdScreenshots.filter(s => s.needsCompanyReview);
  await intakeBatches.set({
    id: intakeId,
    status: unassigned.length > 0 && assigned.length > 0 ? "partial" : unassigned.length === files.length ? "failed" : "completed",
    screenshotsReceived: files.length,
    screenshotsAssigned: assigned.length,
    companiesCreated,
    companiesReused,
    unassignedCount: unassigned.length,
    peopleExtracted,
    note: errors.length > 0 ? `Errors: ${errors.join("; ")}` : undefined,
    createdAt: now,
    completedAt: nowIso(),
  });

  await writeAudit({
    eventType: "bulk_intake_completed",
    batchId: intakeId,
    detail: `received=${files.length}, assigned=${assigned.length}, unassigned=${unassigned.length}, companiesCreated=${companiesCreated}, companiesReused=${companiesReused}, people=${peopleExtracted}`,
  });

  res.status(201).json({
    intakeBatchId: intakeId,
    screenshotsReceived: files.length,
    screenshotsAssigned: assigned.length,
    companiesCreated,
    companiesReused,
    unassignedCount: unassigned.length,
    peopleExtracted,
    assignedScreenshots: assigned.map(s => ({ id: s.id, filename: s.originalFilename })),
    unassignedScreenshots: unassigned.map(s => ({ id: s.id, filename: s.originalFilename, reason: "Low company inference confidence" })),
    warnings: errors.length > 0 ? errors : undefined,
  });
});

intakeRouter.get("/batches", async (_req, res) => {
  res.json(await intakeBatches.all());
});

intakeRouter.get("/unassigned", async (_req, res) => {
  const all = await screenshots.all();
  const unassigned = all.filter((s) => s.needsCompanyReview);
  res.json({ count: unassigned.length, screenshots: unassigned });
});
