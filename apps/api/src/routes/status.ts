import { Router } from "express";
import {
  companies,
  batches,
  screenshots,
  extractionRuns,
  extractedPeople,
  mutualContacts,
  reviewDecisions,
  extractionAttempts,
} from "../store/db.js";
import {
  projectLatestReviewStates,
  isLatestApproved,
  evaluateEligibility,
  detectDuplicates,
  type ExtractionPerson,
  type ExtractedPerson,
} from "@crm-feed/shared";

export const statusRouter = Router();

function toShape(
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
    mutualContacts: { named, vagueCount: vague?.vagueCount ?? null },
    sourceScreenshotIds: entity.sourceScreenshotIds,
    confidence: entity.confidence,
  };
}

// Company status summary
statusRouter.get("/company/:companyId", async (req, res) => {
  const company = await companies.get(req.params.companyId);
  if (!company) return res.status(404).json({ error: "company_not_found" });

  const allBatches = await batches.all();
  const allShots = await screenshots.all();
  const allRuns = await extractionRuns.all();
  const allPeople = await extractedPeople.all();
  const allMutuals = await mutualContacts.all();
  const allReviews = await reviewDecisions.all();

  const companyBatches = allBatches.filter((b) => b.companyId === company.id);
  const batchIds = new Set(companyBatches.map((b) => b.id));
  const companyShots = allShots.filter((s) => batchIds.has(s.batchId));
  const companyRuns = allRuns.filter((r) => batchIds.has(r.batchId));
  const companyPeople = allPeople.filter((p) => p.companyId === company.id);

  const reviewStates = projectLatestReviewStates(allReviews);

  // Reconstruct for eligibility/dedup
  const reconstructed = companyPeople.map((p) => {
    const pmutuals = allMutuals
      .filter((m) => m.extractedPersonId === p.id)
      .map((m) => ({ name: m.name, excludedFromEmail: m.excludedFromEmail, vagueCount: m.vagueCount }));
    return toShape(p, pmutuals);
  });

  const dedupResult = detectDuplicates(reconstructed, company.name);

  let eligibleCount = 0;
  let approvedCount = 0;
  let rejectedCount = 0;
  let exportReadyCount = 0;

  for (const person of reconstructed) {
    const elig = evaluateEligibility({ person, targetCompanyName: company.name });
    const state = reviewStates.get(person.personId);
    const approved = isLatestApproved(state);

    if (elig.eligible) eligibleCount++;
    if (approved && state) {
      if (state.latestDecision === "approved") approvedCount++;
      if (state.latestDecision === "rejected") rejectedCount++;
    }
    if (approved && elig.eligible) exportReadyCount++;
  }

  const pendingRuns = companyRuns.filter(
    (r) => r.status === "pending_extraction" || r.status === "pending_credentials"
  ).length;
  const runsWithPayload = companyRuns.filter(
    (r) => r.status === "review_ready" || r.status === "completed"
  ).length;

  const allAttempts = await extractionAttempts.all();
  const companyShotIds = new Set(companyShots.map((s) => s.id));
  const companyAttempts = allAttempts.filter((a) => companyShotIds.has(a.screenshotId));
  const geminiPeople = companyPeople.filter((p) => p.provenance === "gemini");

  res.json({
    company: { id: company.id, name: company.name },
    counts: {
      batches: companyBatches.length,
      screenshotsUploaded: companyShots.length,
      extractionRunsTotal: companyRuns.length,
      extractionRunsPending: pendingRuns,
      extractionRunsWithPayload: runsWithPayload,
      extractedPeople: companyPeople.length,
      eligiblePeople: eligibleCount,
      approvedPeople: approvedCount,
      rejectedPeople: rejectedCount,
      duplicateCandidates: dedupResult.flaggedPersonIds.length,
      exportReadyPeople: exportReadyCount,
      extractionAttempts: companyAttempts.length,
      geminiExtractedPeople: geminiPeople.length,
    },
  });
});

// Batch status summary
statusRouter.get("/batch/:batchId", async (req, res) => {
  const batch = await batches.get(req.params.batchId);
  if (!batch) return res.status(404).json({ error: "batch_not_found" });

  const allShots = await screenshots.all();
  const allRuns = await extractionRuns.all();
  const allPeople = await extractedPeople.all();

  const batchShots = allShots.filter((s) => s.batchId === batch.id);
  const batchRuns = allRuns.filter((r) => r.batchId === batch.id);
  const batchRunIds = new Set(batchRuns.map((r) => r.id));
  const batchPeople = allPeople.filter((p) => batchRunIds.has(p.extractionRunId));

  res.json({
    batch: { id: batch.id, label: batch.label, status: batch.status },
    counts: {
      screenshots: batchShots.length,
      extractionRuns: batchRuns.length,
      extractedPeople: batchPeople.length,
    },
  });
});
