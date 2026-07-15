// Audit API — list recent audit events with optional filtering.
// Never exposes secrets (audit events never contain them by construction).
import { Router } from "express";
import { auditEvents } from "../store/db.js";
import type { AuditEventType } from "@crm-feed/shared";

export const auditRouter = Router();

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

auditRouter.get("/", async (req, res) => {
  const all = await auditEvents.all();
  // Newest first.
  const sorted = all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const companyId = typeof req.query.companyId === "string" ? req.query.companyId : undefined;
  const eventType = typeof req.query.eventType === "string" ? (req.query.eventType as AuditEventType) : undefined;
  const limitRaw = Number(req.query.limit ?? DEFAULT_LIMIT);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(1, limitRaw), MAX_LIMIT) : DEFAULT_LIMIT;

  let filtered = sorted;
  if (companyId) filtered = filtered.filter((e) => e.companyId === companyId);
  if (eventType) filtered = filtered.filter((e) => e.eventType === eventType);

  const page = filtered.slice(0, limit);
  res.json({
    total: filtered.length,
    returned: page.length,
    limit,
    events: page,
  });
});

auditRouter.get("/:id", async (req, res) => {
  const event = await auditEvents.get(req.params.id);
  if (!event) return res.status(404).json({ error: "not_found" });
  res.json(event);
});
