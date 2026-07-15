import { Router } from "express";
import { z } from "zod";
import { companies, batches, screenshots } from "../store/db.js";
import { newId, nowIso } from "../util/id.js";

export const batchesRouter = Router();

const CreateBatchSchema = z.object({
  companyId: z.string().min(1),
  label: z.string().max(200).optional(),
});

batchesRouter.post("/", async (req, res) => {
  const parsed = CreateBatchSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_batch", detail: parsed.error.toString() });
  }
  const company = await companies.get(parsed.data.companyId);
  if (!company) return res.status(404).json({ error: "company_not_found" });

  const now = nowIso();
  const batch = {
    id: newId("bat"),
    companyId: parsed.data.companyId,
    label: parsed.data.label,
    status: "open" as const,
    createdAt: now,
    updatedAt: now,
  };
  await batches.set(batch);
  res.status(201).json(batch);
});

batchesRouter.get("/", async (_req, res) => {
  const all = await batches.all();
  res.json(all);
});

batchesRouter.get("/:id", async (req, res) => {
  const batch = await batches.get(req.params.id);
  if (!batch) return res.status(404).json({ error: "not_found" });
  const allShots = await screenshots.all();
  const batchShots = allShots.filter((s) => s.batchId === batch.id);
  res.json({ batch, screenshots: batchShots });
});
