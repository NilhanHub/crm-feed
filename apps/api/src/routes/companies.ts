import { Router } from "express";
import { z } from "zod";
import { companies, batches, extractionRuns } from "../store/db.js";
import { newId, nowIso } from "../util/id.js";

export const companiesRouter = Router();

const CreateCompanySchema = z.object({
  name: z.string().min(1).max(200),
  website: z.string().url().optional(),
  notes: z.string().max(2000).optional(),
});

companiesRouter.post("/", async (req, res) => {
  const parsed = CreateCompanySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_company", detail: parsed.error.toString() });
  }
  const now = nowIso();
  const company = {
    id: newId("co"),
    name: parsed.data.name.trim(),
    website: parsed.data.website,
    notes: parsed.data.notes,
    createdAt: now,
    updatedAt: now,
  };
  await companies.set(company);
  res.status(201).json(company);
});

companiesRouter.get("/", async (_req, res) => {
  const all = await companies.all();
  res.json(all);
});

companiesRouter.get("/:id", async (req, res) => {
  const company = await companies.get(req.params.id);
  if (!company) return res.status(404).json({ error: "not_found" });
  const allBatches = await batches.all();
  const allRuns = await extractionRuns.all();
  const companyBatches = allBatches.filter((b) => b.companyId === company.id);
  const batchIds = new Set(companyBatches.map((b) => b.id));
  const companyRuns = allRuns.filter((r) => batchIds.has(r.batchId));
  res.json({ company, batches: companyBatches, extractionRuns: companyRuns });
});
