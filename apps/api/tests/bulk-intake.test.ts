import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import {
  companies, batches, screenshots, extractedPeople,
  mutualContacts, eligibilityDecisions,
  reviewDecisions, crmSyncRecords, emailDrafts,
  exportBatches, extractionAttempts, rawResponses,
  auditEvents, intakeBatches,
} from "../src/store/db.js";
import { nowIso } from "../src/util/id.js";

const app = createApp();

const ALL_COLLECTIONS = [
  companies, batches, screenshots, extractedPeople,
  mutualContacts, eligibilityDecisions,
  reviewDecisions, crmSyncRecords, emailDrafts,
  exportBatches, extractionAttempts, rawResponses,
  auditEvents, intakeBatches,
];

async function clearCollections() {
  await Promise.all(ALL_COLLECTIONS.map((c) => c.clear()));
}

const MINI_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==", "base64");

describe("Bulk Intake API", () => {
  beforeEach(async () => { await clearCollections(); });

  it("POST /api/intake/bulk-screenshots returns 400 for empty upload", async () => {
    const res = await request(app)
      .post("/api/intake/bulk-screenshots")
      .expect(400);
    expect(res.body.error).toBe("no_files_uploaded");
  });

  it("POST /api/intake/bulk-screenshots stores screenshots and returns summary (no Gemini key)", { timeout: 15000 }, async () => {
    const res = await request(app)
      .post("/api/intake/bulk-screenshots")
      .attach("screenshots", MINI_PNG, "shot1.png")
      .attach("screenshots", MINI_PNG, "shot2.png")
      .expect(201);

    expect(res.body.intakeBatchId).toBeDefined();
    expect(res.body.screenshotsReceived).toBe(2);
    expect(res.body.screenshotsAssigned).toBe(0);
    expect(res.body.unassignedCount).toBe(2);
    expect(res.body.companiesCreated).toBe(0);
    expect(res.body.companiesReused).toBe(0);
    expect(res.body.peopleExtracted).toBe(0);
    expect(res.body.unassignedScreenshots).toHaveLength(2);
    expect(res.body.assignedScreenshots).toHaveLength(0);

    const storedBatches = await intakeBatches.all();
    expect(storedBatches).toHaveLength(1);
    expect(storedBatches[0]!.id).toBe(res.body.intakeBatchId);
    expect(storedBatches[0]!.status).toBe("failed");

    const allShots = await screenshots.all();
    expect(allShots).toHaveLength(2);
    expect(allShots.every((s) => s.intakeBatchId === res.body.intakeBatchId)).toBe(true);
    expect(allShots.every((s) => s.needsCompanyReview)).toBe(true);

    const events = await auditEvents.all();
    const intakeEvents = events.filter((e) => e.eventType === "intake_screenshot_uploaded");
    expect(intakeEvents).toHaveLength(2);
    const completionEvent = events.find((e) => e.eventType === "bulk_intake_completed");
    expect(completionEvent).toBeDefined();
    expect(completionEvent!.detail).toContain("received=2");
    expect(completionEvent!.detail).toContain("unassigned=2");
  });

  it("POST /api/intake/bulk-screenshots rejects unsupported file types", async () => {
    const res = await request(app)
      .post("/api/intake/bulk-screenshots")
      .attach("screenshots", Buffer.from("not an image"), {
        filename: "doc.pdf",
        contentType: "application/pdf",
      })
      .expect(400);
    expect(res.body.error ?? res.body.message ?? "").toMatch(/unsupported_file_type|request_failed/i);
  });

  it("GET /api/intake/batches returns stored intake batches", { timeout: 15000 }, async () => {
    const uploadRes = await request(app)
      .post("/api/intake/bulk-screenshots")
      .attach("screenshots", MINI_PNG, "test.png")
      .expect(201);

    const res = await request(app).get("/api/intake/batches").expect(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]!.id).toBe(uploadRes.body.intakeBatchId);
  });

  it("GET /api/intake/unassigned returns screenshots needing company review", async () => {
    const now = nowIso();
    await screenshots.set({
      id: "shot1", batchId: "b1", originalFilename: "a.png",
      storedFilename: "a.png", storagePath: "uploads/a.png",
      mimeType: "image/png", sizeBytes: 100, sha256: "a",
      intakeBatchId: "intake1", uploadedAt: now,
      needsCompanyReview: true, inferenceConfidence: 0.1,
    });
    await screenshots.set({
      id: "shot2", batchId: "b2", originalFilename: "b.png",
      storedFilename: "b.png", storagePath: "uploads/b.png",
      mimeType: "image/png", sizeBytes: 100, sha256: "b",
      intakeBatchId: "intake2", uploadedAt: now,
      needsCompanyReview: false,
    });

    const res = await request(app).get("/api/intake/unassigned").expect(200);
    expect(res.body.count).toBe(1);
    expect(res.body.screenshots).toHaveLength(1);
    expect(res.body.screenshots[0]!.id).toBe("shot1");
  });
});
