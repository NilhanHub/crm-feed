import { Router } from "express";
import { z } from "zod";
import {
  companies,
  extractedPeople,
  reviewDecisions,
  mutualContacts,
  emailDrafts,
} from "../store/db.js";
import { newId, nowIso } from "../util/id.js";
import { writeAudit } from "../audit/writer.js";
import {
  composeEmailPeople,
  formatEmailDraft,
  projectLatestReviewStates,
  approvedPersonIds,
  RULES_VERSION,
  type ExtractionPerson,
  type ExtractedPerson,
} from "@crm-feed/shared";

export const emailRouter = Router();

const CreateEmailSchema = z.object({
  companyId: z.string().min(1),
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

emailRouter.post("/", async (req, res) => {
  const parsed = CreateEmailSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_email_request", detail: parsed.error.toString() });
  }
  const company = await companies.get(parsed.data.companyId);
  if (!company) return res.status(404).json({ error: "company_not_found" });

  const allPeople = await extractedPeople.all();
  const allMutuals = await mutualContacts.all();
  const allReviews = await reviewDecisions.all();

  // FIX (Round 1 bug B): Company-scoped
  const companyPeople = allPeople.filter((p) => p.companyId === company.id);

  // FIX (Round 1 bug C): Latest review state only — use projection
  const reviewStates = projectLatestReviewStates(allReviews);
  const approvedIds = approvedPersonIds(reviewStates);

  const reconstructed = companyPeople.map((p) => {
    const pmutuals = allMutuals
      .filter((m) => m.extractedPersonId === p.id)
      .map((m) => ({ name: m.name, excludedFromEmail: m.excludedFromEmail, vagueCount: m.vagueCount }));
    return toExtractionPersonShape(p, pmutuals);
  });

  const emailPeople = composeEmailPeople({
    people: reconstructed,
    targetCompanyName: company.name,
    approvedPersonIds: approvedIds,
  });

  const body = formatEmailDraft(company.name, emailPeople);

  const draft = {
    id: newId("email"),
    companyId: company.id,
    body,
    personIds: emailPeople.filter((p) => p.approved).map((p) => p.id),
    rulesVersion: RULES_VERSION,
    createdAt: nowIso(),
  };
  await emailDrafts.set(draft);
  await writeAudit({
    eventType: "email_generated",
    companyId: company.id,
    emailDraftId: draft.id,
    detail: `${draft.personIds.length} approved person(s) included`,
  });
  res.status(201).json(draft);
});

emailRouter.get("/", async (_req, res) => {
  res.json(await emailDrafts.all());
});

emailRouter.get("/:id", async (req, res) => {
  const draft = await emailDrafts.get(req.params.id);
  if (!draft) return res.status(404).json({ error: "not_found" });
  res.json(draft);
});
