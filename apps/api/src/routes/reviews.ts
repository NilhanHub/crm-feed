import { Router } from "express";
import { z } from "zod";
import {
  extractedPeople,
  reviewDecisions,
  eligibilityDecisions,
  companies,
  extractionRuns,
  mutualContacts,
  screenshots,
  batches,
} from "../store/db.js";
import { newId, nowIso } from "../util/id.js";
import { writeAudit } from "../audit/writer.js";
import {
  projectLatestReviewStates,
  getReviewHistory,
  detectDuplicates,
  evaluateEligibility,
  scorePerson,
  type ExtractionPerson,
  type ExtractedPerson,
} from "@crm-feed/shared";

export const reviewsRouter = Router();

const CreateReviewSchema = z.object({
  extractedPersonId: z.string().min(1),
  decision: z.enum(["approved", "rejected", "needs_review"]),
  note: z.string().max(2000).optional(),
});

// Submit a review decision (append to history; latest is authoritative)
reviewsRouter.post("/", async (req, res) => {
  const parsed = CreateReviewSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_review", detail: parsed.error.toString() });
  }
  const person = await extractedPeople.get(parsed.data.extractedPersonId);
  if (!person) return res.status(404).json({ error: "person_not_found" });

  const review = {
    id: newId("rev"),
    extractedPersonId: person.id,
    decision: parsed.data.decision,
    note: parsed.data.note,
    reviewedBy: "Nilhan",
    decidedAt: nowIso(),
  };
  await reviewDecisions.set(review);
  await writeAudit({
    eventType: "review_decision_created",
    companyId: person.companyId,
    personId: person.id,
    detail: `decision=${review.decision}${review.note ? ` note="${review.note.slice(0, 80)}"` : ""}`,
  });
  res.status(201).json(review);
});

// Bulk approve all eligible people for a company (skips already-approved, rejected, needs-review)
reviewsRouter.post("/bulk-approve-eligible/:companyId", async (req, res) => {
  const company = await companies.get(req.params.companyId);
  if (!company) return res.status(404).json({ error: "company_not_found" });

  const allPeople = await extractedPeople.all();
  const allMutuals = await mutualContacts.all();
  const allReviews = await reviewDecisions.all();

  const companyPeople = allPeople.filter((p) => p.companyId === company.id);
  const reviewStates = projectLatestReviewStates(allReviews);

  const approvedPeople: { id: string; name: string }[] = [];
  const skippedPeople: { id: string; name: string; reason: string }[] = [];

  for (const person of companyPeople) {
    const state = reviewStates.get(person.id) ?? null;

    // Skip already approved
    if (state && state.latestDecision === "approved") {
      skippedPeople.push({ id: person.id, name: person.name, reason: "Already approved" });
      continue;
    }

    // Skip rejected (simplest safe default — human must explicitly override)
    if (state && state.latestDecision === "rejected") {
      skippedPeople.push({ id: person.id, name: person.name, reason: "Rejected — needs review before bulk approval" });
      continue;
    }

    // Skip needs-review (simplest safe default)
    if (state && state.latestDecision === "needs_review") {
      skippedPeople.push({ id: person.id, name: person.name, reason: "Marked needs review — review individually" });
      continue;
    }

    // Check eligibility deterministically
    const personMutuals = allMutuals
      .filter((m) => m.extractedPersonId === person.id)
      .map((m) => ({ name: m.name, excludedFromEmail: m.excludedFromEmail, vagueCount: m.vagueCount }));
    const shape = toExtractionPersonShape(person, personMutuals);
    const elig = evaluateEligibility({ person: shape, targetCompanyName: company.name });

    if (!elig.eligible) {
      skippedPeople.push({
        id: person.id,
        name: person.name,
        reason: elig.reasons.join("; "),
      });
      continue;
    }

    // Create approval review decision
    const review = {
      id: newId("rev"),
      extractedPersonId: person.id,
      decision: "approved" as const,
      reviewedBy: "Nilhan",
      decidedAt: nowIso(),
    };
    await reviewDecisions.set(review);
    approvedPeople.push({ id: person.id, name: person.name });
  }

  // Write a single audit event for the bulk action
  if (approvedPeople.length > 0) {
    const approvedIds = approvedPeople.map((p) => p.id);
    const detail = `approved=${approvedPeople.length}, skipped=${skippedPeople.length}, people=[${approvedIds.join(",")}]`;
    await writeAudit({
      eventType: "bulk_approve_completed",
      companyId: company.id,
      detail: detail.slice(0, 2000),
    });
  }

  res.json({
    approvedCount: approvedPeople.length,
    skippedCount: skippedPeople.length,
    approvedPeople,
    skippedPeople,
  });
});

// List all review decisions
reviewsRouter.get("/", async (_req, res) => {
  res.json(await reviewDecisions.all());
});

// Review queue for a company: people from that company's runs with eligibility + latest review + mutuals + ranking
reviewsRouter.get("/company/:companyId", async (req, res) => {
  const company = await companies.get(req.params.companyId);
  if (!company) return res.status(404).json({ error: "company_not_found" });

  const allPeople = await extractedPeople.all();
  const allMutuals = await mutualContacts.all();
  const allElig = await eligibilityDecisions.all();
  const allReviews = await reviewDecisions.all();
  const allRuns = await extractionRuns.all();
  const allShots = await screenshots.all();

  // Company-scoped
  const companyPeople = allPeople.filter((p) => p.companyId === company.id);
  const reviewStates = projectLatestReviewStates(allReviews);

  // Detect duplicates
  const reconstructed = companyPeople.map((p) => {
    const pmutuals = allMutuals
      .filter((m) => m.extractedPersonId === p.id)
      .map((m) => ({ name: m.name, excludedFromEmail: m.excludedFromEmail, vagueCount: m.vagueCount }));
    return toExtractionPersonShape(p, pmutuals);
  });

  const dedupResult = detectDuplicates(reconstructed, company.name);
  const flaggedIds = new Set(dedupResult.flaggedPersonIds);

  const items = companyPeople.map((p) => {
    const run = allRuns.find((r) => r.id === p.extractionRunId) ?? null;
    const elig = allElig.find((e) => e.extractedPersonId === p.id) ?? null;
    const state = reviewStates.get(p.id) ?? null;
    const mutuals = allMutuals.filter((m) => m.extractedPersonId === p.id);
    const sourceShots = allShots.filter((s) => p.sourceScreenshotIds.includes(s.id));

    // Compute ranking score
    const personShape = reconstructed.find((rp) => rp.personId === p.id);
    const scored = personShape ? scorePerson(personShape) : null;

    return {
      person: p,
      run,
      eligibility: elig,
      reviewState: state,
      mutuals,
      sourceScreenshots: sourceShots.map((s) => ({ id: s.id, originalFilename: s.originalFilename, storagePath: s.storagePath })),
      isDuplicateCandidate: flaggedIds.has(p.id),
      rankScore: scored?.score ?? null,
      rankTier: scored?.tier ?? null,
    };
  });
  res.json({ company, items });
});

// Review queue for a batch
reviewsRouter.get("/batch/:batchId", async (req, res) => {
  const batch = await batches.get(req.params.batchId);
  if (!batch) return res.status(404).json({ error: "batch_not_found" });
  const company = await companies.get(batch.companyId);
  if (!company) return res.status(404).json({ error: "company_not_found" });

  const allPeople = await extractedPeople.all();
  const allRuns = await extractionRuns.all();
  const allMutuals = await mutualContacts.all();
  const allElig = await eligibilityDecisions.all();
  const allReviews = await reviewDecisions.all();

  const batchRunIds = new Set(allRuns.filter((r) => r.batchId === batch.id).map((r) => r.id));
  const batchPeople = allPeople.filter((p) => batchRunIds.has(p.extractionRunId));
  const reviewStates = projectLatestReviewStates(allReviews);

  const items = batchPeople.map((p) => {
    const run = allRuns.find((r) => r.id === p.extractionRunId) ?? null;
    const elig = allElig.find((e) => e.extractedPersonId === p.id) ?? null;
    const state = reviewStates.get(p.id) ?? null;
    const mutuals = allMutuals.filter((m) => m.extractedPersonId === p.id);
    return { person: p, run, eligibility: elig, reviewState: state, mutuals };
  });
  res.json({ batch, company, items });
});

// Get person details with screenshot/source provenance
reviewsRouter.get("/person/:personId", async (req, res) => {
  const person = await extractedPeople.get(req.params.personId);
  if (!person) return res.status(404).json({ error: "person_not_found" });

  const allMutuals = await mutualContacts.all();
  const allElig = await eligibilityDecisions.all();
  const allReviews = await reviewDecisions.all();
  const allShots = await screenshots.all();
  const allRuns = await extractionRuns.all();

  const mutuals = allMutuals.filter((m) => m.extractedPersonId === person.id);
  const elig = allElig.find((e) => e.extractedPersonId === person.id) ?? null;
  const history = getReviewHistory(allReviews, person.id);
  const sourceShots = allShots.filter((s) => person.sourceScreenshotIds.includes(s.id));
  const run = allRuns.find((r) => r.id === person.extractionRunId) ?? null;
  const reviewStates = projectLatestReviewStates(allReviews);
  const state = reviewStates.get(person.id) ?? null;

  res.json({
    person,
    mutuals,
    eligibility: elig,
    reviewState: state,
    reviewHistory: history,
    sourceScreenshots: sourceShots.map((s) => ({
      id: s.id,
      originalFilename: s.originalFilename,
      storagePath: s.storagePath,
      sha256: s.sha256,
      mimeType: s.mimeType,
      sizeBytes: s.sizeBytes,
    })),
    run,
  });
});

// List review history for a person
reviewsRouter.get("/person/:personId/history", async (req, res) => {
  const person = await extractedPeople.get(req.params.personId);
  if (!person) return res.status(404).json({ error: "person_not_found" });
  const allReviews = await reviewDecisions.all();
  const history = getReviewHistory(allReviews, person.id);
  res.json(history);
});

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

// Edit-before-approval: update extracted person fields without deleting provenance.
// Stores reviewer-normalized data; raw extraction provenance (sourceScreenshotIds,
// extractionRunId) is preserved.
const EditPersonSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  headline: z.string().max(500).nullable().optional(),
  title: z.string().max(200).nullable().optional(),
  location: z.string().max(200).nullable().optional(),
  currentRoles: z.array(z.object({ title: z.string().min(1), company: z.string().min(1) })).optional(),
  mutualContactEdits: z.array(z.object({
    id: z.string().optional(),
    name: z.string().min(1),
    headline: z.string().optional(),
    action: z.enum(["add", "update", "remove"]),
  })).optional(),
});

reviewsRouter.patch("/person/:personId", async (req, res) => {
  const parsed = EditPersonSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_edit", detail: parsed.error.toString() });
  }
  const person = await extractedPeople.get(req.params.personId);
  if (!person) return res.status(404).json({ error: "person_not_found" });

  // Update person fields (preserve provenance: sourceScreenshotIds, extractionRunId, companyId)
  const updated = {
    ...person,
    ...(parsed.data.name !== undefined && { name: parsed.data.name }),
    ...(parsed.data.headline !== undefined && { headline: parsed.data.headline ?? undefined }),
    ...(parsed.data.title !== undefined && { title: parsed.data.title ?? undefined }),
    ...(parsed.data.location !== undefined && { location: parsed.data.location ?? undefined }),
    ...(parsed.data.currentRoles !== undefined && { currentRoles: parsed.data.currentRoles }),
  };
  await extractedPeople.set(updated);

  // Handle mutual contact edits
  if (parsed.data.mutualContactEdits) {
    const allMutuals = await mutualContacts.all();
    const personMutuals = allMutuals.filter((m) => m.extractedPersonId === person.id);

    for (const edit of parsed.data.mutualContactEdits) {
      if (edit.action === "add") {
        await mutualContacts.set({
          id: newId("mut"),
          extractedPersonId: person.id,
          name: edit.name,
          headline: edit.headline,
          excludedFromEmail: false,
        });
      } else if (edit.action === "update" && edit.id) {
        const existing = personMutuals.find((m) => m.id === edit.id);
        if (existing) {
          await mutualContacts.set({
            ...existing,
            name: edit.name,
            headline: edit.headline ?? existing.headline,
          });
        }
      } else if (edit.action === "remove" && edit.id) {
        await mutualContacts.remove(edit.id);
      }
    }
  }

  // Recompute eligibility
  const allMutuals2 = await mutualContacts.all();
  const personMutuals2 = allMutuals2.filter((m) => m.extractedPersonId === person.id);
  const company = await companies.get(person.companyId);
  if (company) {
    const shape = toExtractionPersonShape(updated, personMutuals2.map((m) => ({
      name: m.name, excludedFromEmail: m.excludedFromEmail, vagueCount: m.vagueCount,
    })));
    const elig = evaluateEligibility({ person: shape, targetCompanyName: company.name });
    await eligibilityDecisions.set({
      id: `elig_${person.id}`,
      extractedPersonId: person.id,
      eligible: elig.eligible,
      reasons: elig.reasons,
      computedAt: nowIso(),
    });
  }

  res.json({ person: updated, message: "Person edited. Provenance preserved." });
});
