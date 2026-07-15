import { Router } from "express";
import {
  companies,
  screenshots,
  extractionRuns,
  extractedPeople,
  reviewDecisions,
  personObservations,
  masterPeople,
  employmentObservations,
  mutualConnectionObservations,
} from "../store/db.js";

export const masterDbRouter = Router();

// GET /api/master/stats — master database statistics
masterDbRouter.get("/stats", async (_req, res) => {
  const [
    allShots,
    allRuns,
    allCompanies,
    allPersonObs,
    allMasterPeople,
    allEmployObs,
    allMutualObs,
  ] = await Promise.all([
    screenshots.all(),
    extractionRuns.all(),
    companies.all(),
    personObservations.all(),
    masterPeople.all(),
    employmentObservations.all(),
    mutualConnectionObservations.all(),
  ]);

  const unassignedShots = allShots.filter(
    (s) => s.needsCompanyReview || s.assignmentState === "unassigned" || s.assignmentState === "needs_company_review"
  );

  const namedMutuals = allMutualObs.filter((m) => m.type === "named");
  const vagueMutuals = allMutualObs.filter((m) => m.type === "vague_count");

  res.json({
    screenshotsStored: allShots.length,
    extractionRuns: allRuns.length,
    companies: allCompanies.length,
    personObservations: allPersonObs.length,
    masterPeople: allMasterPeople.length,
    employmentObservations: allEmployObs.length,
    namedMutualObservations: namedMutuals.length,
    vagueMutualObservations: vagueMutuals.length,
    unassignedScreenshots: unassignedShots.length,
  });
});

// GET /api/master/screenshots — list all screenshots
masterDbRouter.get("/screenshots", async (_req, res) => {
  const all = await screenshots.all();
  const sorted = all.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
  res.json(sorted);
});

// GET /api/master/screenshots/:id — screenshot detail with provenance
masterDbRouter.get("/screenshots/:id", async (req, res) => {
  const shot = await screenshots.get(req.params.id);
  if (!shot) return res.status(404).json({ error: "screenshot_not_found" });

  const [allRuns, allPersonObs] = await Promise.all([
    extractionRuns.all(),
    personObservations.all(),
  ]);

  const linkedRuns = allRuns.filter((r) =>
    shot.extractionRunIds?.includes(r.id) || r.screenshotIds?.includes(shot.id)
  );

  const linkedObs = allPersonObs.filter(
    (o) => o.sourceScreenshotId === shot.id
  );

  res.json({
    screenshot: shot,
    extractionRuns: linkedRuns,
    personObservations: linkedObs,
  });
});

// GET /api/master/screenshots/unassigned — unassigned screenshots
masterDbRouter.get("/screenshots/unassigned", async (_req, res) => {
  const all = await screenshots.all();
  const unassigned = all.filter(
    (s) => s.needsCompanyReview || s.assignmentState === "unassigned" || s.assignmentState === "needs_company_review"
  );
  res.json({ count: unassigned.length, screenshots: unassigned });
});

// GET /api/master/companies/:companyId/people — company-scoped people with observations
masterDbRouter.get("/companies/:companyId/people", async (req, res) => {
  const company = await companies.get(req.params.companyId);
  if (!company) return res.status(404).json({ error: "company_not_found" });

  const [allPeople, allPersonObs, allEmployObs, allMutualObs, allShots, allRuns] = await Promise.all([
    extractedPeople.all(),
    personObservations.all(),
    employmentObservations.all(),
    mutualConnectionObservations.all(),
    screenshots.all(),
    extractionRuns.all(),
  ]);

  // Company-scoped: only people from this company's batches
  const companyExtractedPeople = allPeople.filter((p) => p.companyId === company.id);

  // Build response with observation links
  const peopleWithObservations = companyExtractedPeople.map((p) => {
    const obs = allPersonObs.filter((o) => o.extractedPersonId === p.id);
    const employObs = allEmployObs.filter((e) => obs.some((o) => o.id === e.personObservationId));
    const mutualObs = allMutualObs.filter((m) => obs.some((o) => o.id === m.personObservationId));
    const sourceShots = allShots.filter((s) => p.sourceScreenshotIds.includes(s.id));
    const run = allRuns.find((r) => r.id === p.extractionRunId) ?? null;

    return {
      extractedPerson: {
        id: p.id,
        name: p.name,
        title: p.title,
        headline: p.headline,
        location: p.location,
        currentlyAtTargetCompany: p.currentlyAtTargetCompany,
        confidence: p.confidence,
      },
      observations: obs,
      employmentObservations: employObs,
      mutualConnectionObservations: mutualObs,
      sourceScreenshots: sourceShots.map((s) => ({
        id: s.id,
        originalFilename: s.originalFilename,
        storagePath: s.storagePath,
        sha256: s.sha256,
      })),
      extractionRun: run
        ? { id: run.id, status: run.status, provider: run.provider }
        : null,
    };
  });

  res.json({
    company: { id: company.id, name: company.name },
    people: peopleWithObservations,
    totalCount: peopleWithObservations.length,
  });
});

// GET /api/master/people — list all master people
masterDbRouter.get("/people", async (_req, res) => {
  const [allMaster, allObs, allEmployObs, allMutualObs] = await Promise.all([
    masterPeople.all(),
    personObservations.all(),
    employmentObservations.all(),
    mutualConnectionObservations.all(),
  ]);

  const enriched = allMaster.map((mp) => {
    const obs = allObs.filter((o) => mp.personObservationIds.includes(o.id));
    const employObs = allEmployObs.filter((e) => mp.personObservationIds.includes(e.personObservationId));
    const mutualObs = allMutualObs.filter((m) => mp.personObservationIds.includes(m.personObservationId));

    return {
      masterPerson: mp,
      observations: obs,
      employmentObservations: employObs,
      mutualConnectionObservations: mutualObs,
    };
  });

  res.json({ masterPeople: enriched, totalCount: enriched.length });
});

// GET /api/master/people/:id — person detail with full provenance
masterDbRouter.get("/people/:id", async (req, res) => {
  const mp = await masterPeople.get(req.params.id);
  if (!mp) return res.status(404).json({ error: "master_person_not_found" });

  const [allObs, allEmployObs, allMutualObs, allShots, allRuns, allReviews] = await Promise.all([
    personObservations.all(),
    employmentObservations.all(),
    mutualConnectionObservations.all(),
    screenshots.all(),
    extractionRuns.all(),
    reviewDecisions.all(),
  ]);

  const obs = allObs.filter((o) => mp.personObservationIds.includes(o.id));
  const employObs = allEmployObs.filter((e) => obs.some((o) => o.id === e.personObservationId));
  const mutualObs = allMutualObs.filter((m) => obs.some((o) => o.id === m.personObservationId));

  const sourceShotIds = new Set(obs.map((o) => o.sourceScreenshotId));
  const sourceRunIds = new Set(obs.map((o) => o.extractionRunId));
  const sourceShots = allShots.filter((s) => sourceShotIds.has(s.id));
  const sourceRuns = allRuns.filter((r) => sourceRunIds.has(r.id));

  // Review states for linked extracted people
  const extractedPersonIds = mp.extractedPersonIds;
  const relevantReviews = allReviews.filter((r) => extractedPersonIds.includes(r.extractedPersonId));

  res.json({
    masterPerson: mp,
    observations: obs,
    employmentObservations: employObs,
    mutualConnectionObservations: mutualObs,
    sourceScreenshots: sourceShots.map((s) => ({
      id: s.id, originalFilename: s.originalFilename, storagePath: s.storagePath, sha256: s.sha256,
    })),
    extractionRuns: sourceRuns.map((r) => ({ id: r.id, status: r.status, provider: r.provider })),
    reviewDecisions: relevantReviews,
    identityNote: "MasterPerson uses conservative identity resolution. Not all observations may be merged.",
  });
});

// GET /api/master/observations — query observations with filters
masterDbRouter.get("/observations", async (req, res) => {
  const personId = req.query.personId as string | undefined;
  const companyId = req.query.companyId as string | undefined;
  const screenshotId = req.query.screenshotId as string | undefined;

  const [allObs, allEmployObs, allMutualObs] = await Promise.all([
    personObservations.all(),
    employmentObservations.all(),
    mutualConnectionObservations.all(),
  ]);

  let filteredObs = allObs;

  if (screenshotId) {
    filteredObs = filteredObs.filter((o) => o.sourceScreenshotId === screenshotId);
  }

  if (companyId) {
    // Filter by company ID through observations that reference this company
    filteredObs = filteredObs.filter(
      (o) => o.currentCompanyId === companyId || o.pastCompanyIds.includes(companyId)
    );
  }

  if (personId) {
    const mp = await masterPeople.get(personId);
    if (mp) {
      filteredObs = filteredObs.filter((o) => mp.personObservationIds.includes(o.id));
    } else {
      // Also check extracted person ID
      filteredObs = filteredObs.filter((o) => o.extractedPersonId === personId);
    }
  }

  const employObs = allEmployObs.filter((e) => filteredObs.some((o) => o.id === e.personObservationId));
  const mutualObs = allMutualObs.filter((m) => filteredObs.some((o) => o.id === m.personObservationId));

  res.json({
    observations: filteredObs,
    employmentObservations: employObs,
    mutualConnectionObservations: mutualObs,
    totalCount: filteredObs.length,
  });
});

// GET /api/master/audit — recent master DB audit events
masterDbRouter.get("/audit", async (req, res) => {
  const { auditEvents } = await import("../store/db.js");
  const all = await auditEvents.all();
  const masterEvents = all.filter((e) =>
    [
      "master_observation_created",
      "master_person_merged",
      "master_db_backfilled",
    ].includes(e.eventType)
  );
  const sorted = masterEvents.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 50);
  res.json({ events: sorted, totalCount: sorted.length });
});

// POST /api/master/backfill — backfill observation records from existing data
masterDbRouter.post("/backfill", async (_req, res) => {
  try {
    const { backfillMasterDb } = await import("../store/masterDbWriter.js");
    const result = await backfillMasterDb();
    const { newId, nowIso } = await import("../util/id.js");
    const { auditEvents } = await import("../store/db.js");
    await auditEvents.set({
      id: newId("aev"),
      eventType: "master_db_backfilled",
      detail: `personObservationsCreated=${result.personObservationsCreated}, masterPeopleCreated=${result.masterPeopleCreated}`,
      actor: "system",
      createdAt: nowIso(),
    });
    res.json({ success: true, ...result });
  } catch (e) {
    res.status(500).json({ error: "backfill_failed", detail: (e as Error).message });
  }
});
