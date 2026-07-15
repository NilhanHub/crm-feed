import { Router } from "express";
import { z } from "zod";
import {
  batches,
  companies,
  extractionRuns,
  extractedPeople,
  mutualContacts,
  eligibilityDecisions,
  screenshots,
} from "../store/db.js";
import { newId, nowIso } from "../util/id.js";
import { writeAudit } from "../audit/writer.js";
import { fileExtractionObservations } from "../store/masterDbWriter.js";
import {
  safeParseExtractionPayload,
  evaluateEligibility,
  computeCurrentlyAtTarget,
  type ExtractionProvider,
  type ExtractionRunStatus,
} from "@crm-feed/shared";

export const extractionRouter = Router();

const CreateRunSchema = z.object({
  batchId: z.string().min(1),
  provider: z.enum(["gemini", "vision_ocr", "document_ai", "manual_attach", "none"]).optional(),
});

// Create a pending extraction run. No fake extraction is performed.
// Without configured credentials, the run is recorded as pending_credentials.
extractionRouter.post("/", async (req, res) => {
  const parsed = CreateRunSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_run", detail: parsed.error.toString() });
  }
  const batch = await batches.get(parsed.data.batchId);
  if (!batch) return res.status(404).json({ error: "batch_not_found" });
  const company = await companies.get(batch.companyId);
  if (!company) return res.status(404).json({ error: "company_not_found" });

  const provider: ExtractionProvider = parsed.data.provider ?? "none";
  const hasCredentials =
    Boolean(process.env.GEMINI_API_KEY) ||
    Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS);

  const now = nowIso();
  const status: ExtractionRunStatus = hasCredentials ? "pending_extraction" : "pending_credentials";
  const error = hasCredentials
    ? undefined
    : "No extraction credentials configured. Attach a real extraction JSON payload via POST /api/extraction-runs/:id/payload, or configure credentials in a later round.";

  const run = {
    id: newId("run"),
    batchId: batch.id,
    status,
    provider,
    error,
    createdAt: now,
    updatedAt: now,
  };
  await extractionRuns.set(run);

  // Keep batch status in sync.
  await batches.update(batch.id, { status: "extraction_pending", updatedAt: now });

  res.status(201).json(run);
});

extractionRouter.get("/:id", async (req, res) => {
  const run = await extractionRuns.get(req.params.id);
  if (!run) return res.status(404).json({ error: "not_found" });
  res.json(run);
});

extractionRouter.get("/", async (_req, res) => {
  res.json(await extractionRuns.all());
});

// Attach a REAL extraction JSON payload for review. Validates against the Zod
// schema and materialises ExtractedPerson + MutualContact + EligibilityDecision
// rows. Never invents people; never fabricates extraction.
const AttachPayloadSchema = z.object({
  payload: z.unknown(),
});

extractionRouter.post("/:id/payload", async (req, res) => {
  const parsedBody = AttachPayloadSchema.safeParse(req.body);
  if (!parsedBody.success) {
    return res.status(400).json({ error: "invalid_body", detail: parsedBody.toString() });
  }
  const run = await extractionRuns.get(req.params.id);
  if (!run) return res.status(404).json({ error: "run_not_found" });
  const batch = await batches.get(run.batchId);
  if (!batch) return res.status(404).json({ error: "batch_not_found" });
  const company = await companies.get(batch.companyId);
  if (!company) return res.status(404).json({ error: "company_not_found" });

  const result = safeParseExtractionPayload(parsedBody.data.payload);
  if (!result.ok) {
    const failed = {
      ...run,
      status: "failed" as const,
      error: `payload_validation_failed: ${result.error}`,
      updatedAt: nowIso(),
    };
    await extractionRuns.set(failed);
    return res.status(400).json({ error: "payload_validation_failed", detail: result.error });
  }

  const payload = result.data;
  const targetCompanyName = company.name;
  const now = nowIso();

  const peopleCreated = [];
  for (const person of payload.people) {
    const personId = newId("person");
    const currentlyAtTarget = computeCurrentlyAtTarget(person, targetCompanyName);
    const extractedPerson = {
      id: personId,
      extractionRunId: run.id,
      companyId: company.id,
      name: person.name,
      headline: person.headline ?? undefined,
      title: person.title ?? undefined,
      location: person.location ?? undefined,
      connectionDegree: person.connectionDegree,
      currentRoles: person.currentRoles,
      pastRoles: person.pastRoles,
      currentlyAtTargetCompany: currentlyAtTarget,
      sourceScreenshotIds: person.sourceScreenshotIds,
      confidence: person.confidence,
      provenance: "manual_attach" as const,
      createdAt: now,
    };
    await extractedPeople.set(extractedPerson);

    // Named mutuals (email-eligible).
    for (const named of person.mutualContacts.named) {
      await mutualContacts.set({
        id: newId("mut"),
        extractedPersonId: personId,
        name: named.name,
        headline: named.headline ?? undefined,
        vagueCount: undefined,
        excludedFromEmail: false,
        sourceScreenshotId: undefined,
      });
    }
    // Vague count (one audit-only record, always excluded from email).
    if (person.mutualContacts.vagueCount != null) {
      await mutualContacts.set({
        id: newId("mut"),
        extractedPersonId: personId,
        name: `__vague_count__`,
        headline: undefined,
        vagueCount: person.mutualContacts.vagueCount,
        excludedFromEmail: true,
        sourceScreenshotId: undefined,
      });
    }

    const elig = evaluateEligibility({ person, targetCompanyName });
    await eligibilityDecisions.set({
      id: newId("elig"),
      extractedPersonId: personId,
      eligible: elig.eligible,
      reasons: elig.reasons,
      computedAt: now,
    });

    peopleCreated.push(extractedPerson);
  }

  const updatedRun = {
    ...run,
    status: "review_ready" as const,
    payload,
    error: undefined,
    completedAt: now,
    updatedAt: now,
  };
  await extractionRuns.set(updatedRun);
  await batches.update(batch.id, { status: "extraction_done", updatedAt: now });

  // File observations into Master DB
  const allShots = await screenshots.all();
  const batchShots = allShots.filter((s) => s.batchId === batch.id);
  // Build mutual contacts map from memory
  const allMutualsForObs = await mutualContacts.all();
  const mutualsByPerson = new Map<string, import("@crm-feed/shared").MutualContact[]>();
  for (const mc of allMutualsForObs) {
    const list = mutualsByPerson.get(mc.extractedPersonId) ?? [];
    list.push(mc);
    mutualsByPerson.set(mc.extractedPersonId, list);
  }

  // File observations for each screenshot
  const processedScreenshots = new Set<string>();
  for (const ep of peopleCreated) {
    for (const sid of ep.sourceScreenshotIds) {
      if (processedScreenshots.has(sid)) continue;
      processedScreenshots.add(sid);
      // Get people linked to this screenshot
      const shotPeople = peopleCreated.filter((p) => p.sourceScreenshotIds.includes(sid));
      await fileExtractionObservations(
        shotPeople,
        mutualsByPerson,
        sid,
        run.id
      );
    }
  }
  // Also file for any batch screenshot without specific people
  for (const shot of batchShots) {
    if (!processedScreenshots.has(shot.id)) {
      const shotPeople = peopleCreated.filter((p) => p.sourceScreenshotIds.includes(shot.id));
      if (shotPeople.length > 0) continue; // Already filed
    }
  }

  await writeAudit({
    eventType: "manual_extraction_imported",
    companyId: company.id,
    batchId: batch.id,
    detail: `${peopleCreated.length} person(s) imported via manual payload attach`,
  });

  res.status(200).json({
    run: updatedRun,
    people: peopleCreated,
    targetCompanyName,
  });
});

// List materialised people for a run, with eligibility + mutuals.
extractionRouter.get("/:id/people", async (req, res) => {
  const run = await extractionRuns.get(req.params.id);
  if (!run) return res.status(404).json({ error: "run_not_found" });
  const allPeople = await extractedPeople.all();
  const allMutuals = await mutualContacts.all();
  const allElig = await eligibilityDecisions.all();
  const people = allPeople.filter((p) => p.extractionRunId === run.id);
  const enriched = people.map((p) => {
    const mutuals = allMutuals.filter((m) => m.extractedPersonId === p.id);
    const elig = allElig.find((e) => e.extractedPersonId === p.id) ?? null;
    return { person: p, mutuals, eligibility: elig };
  });
  res.json({ run, targetCompanyId: run, people: enriched });
});
