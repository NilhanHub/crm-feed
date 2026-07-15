// Round 4 tests — config/health behavior, audit logging, export verification.
import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { newId, nowIso } from "../src/util/id.js";
import {
  companies, batches, screenshots, extractionRuns,
  extractedPeople, mutualContacts, eligibilityDecisions,
  reviewDecisions, crmSyncRecords, emailDrafts,
  exportBatches, extractionAttempts, rawResponses, auditEvents,
} from "../src/store/db.js";

const app = createApp();

const ALL_COLLECTIONS = [
  companies, batches, screenshots, extractionRuns,
  extractedPeople, mutualContacts, eligibilityDecisions,
  reviewDecisions, crmSyncRecords, emailDrafts,
  exportBatches, extractionAttempts, rawResponses, auditEvents,
];

async function clearCollections() {
  await Promise.all(ALL_COLLECTIONS.map((c) => c.clear()));
}

async function seedCompany(): Promise<{ companyId: string; batchId: string }> {
  const companyId = newId("company");
  const batchId = newId("batch");
  const now = nowIso();
  await companies.set({ id: companyId, name: "Test Corp", createdAt: now, updatedAt: now });
  await batches.set({ id: batchId, companyId, status: "open", createdAt: now, updatedAt: now });
  return { companyId, batchId };
}

describe("Round 4 — Config & Health", () => {
  beforeEach(async () => { await clearCollections(); });

  it("health endpoint returns diagnostic fields without exposing secrets", async () => {
    const res = await request(app).get("/api/health").expect(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.appVersion).toBeDefined();
    expect(res.body.rulesVersion).toBe("4.0.0");
    expect(res.body.environment).toBeDefined();
    expect(res.body.deploymentMode).toBe("local-first");
    expect(res.body.deployedToCloud).toBe(false);
    expect(res.body.gemini).toBeDefined();
    expect(res.body.gemini.keyPresent).toBe(false); // no key set in test env
    expect(res.body.storage).toBeDefined();
    expect(res.body.storage.db).toBeDefined();
    expect(res.body.storage.exports).toBeDefined();
    expect(res.body.storage.backups).toBeDefined();
    // The response body must NOT contain a real API key value.
    const bodyStr = JSON.stringify(res.body);
    expect(bodyStr).not.toMatch(/AIzaSy[A-Za-z0-9_-]{30,}/);
  });

  it("missing Gemini key does not crash app — reports pending_credentials", async () => {
    const res = await request(app).get("/api/health").expect(200);
    expect(res.body.gemini.configured).toBe(false);
    expect(res.body.gemini.status).toBe("pending_credentials");
    expect(res.body.status).toBe("ok"); // app is healthy even without Gemini key
  });

  it("storage checks report writability", async () => {
    const res = await request(app).get("/api/health").expect(200);
    expect(res.body.storage.db.writable).toBe(true);
    expect(res.body.storage.db.readableOk).toBe(true);
    expect(res.body.storage.exports.writable).toBe(true);
    expect(res.body.storage.backups.writable).toBe(true);
  });
});

describe("Round 4 — Audit Logging", () => {
  beforeEach(async () => { await clearCollections(); });

  it("audit event written when a review decision is created", async () => {
    const { companyId } = await seedCompany();
    // Create a person to review
    const personId = newId("person");
    const runId = newId("run");
    const now = nowIso();
    await extractionRuns.set({ id: runId, batchId: newId("batch"), status: "review_ready", provider: "manual_attach", createdAt: now, updatedAt: now });
    await extractedPeople.set({
      id: personId, extractionRunId: runId, companyId, name: "Test Person",
      currentRoles: [], pastRoles: [], currentlyAtTargetCompany: true,
      sourceScreenshotIds: [], confidence: 1, createdAt: now,
    });

    await request(app)
      .post("/api/reviews")
      .send({ extractedPersonId: personId, decision: "approved" })
      .expect(201);

    const events = await auditEvents.all();
    const reviewEvents = events.filter((e) => e.eventType === "review_decision_created");
    expect(reviewEvents.length).toBe(1);
    expect(reviewEvents[0].personId).toBe(personId);
    expect(reviewEvents[0].companyId).toBe(companyId);
    // No secrets in audit events
    expect(JSON.stringify(reviewEvents[0])).not.toMatch(/AIzaSy[A-Za-z0-9_-]{30,}/);
  });

  it("audit listing endpoint works with pagination", async () => {
    const { companyId } = await seedCompany();
    // Generate an email draft to trigger audit
    await request(app)
      .post("/api/email-drafts")
      .send({ companyId })
      .expect(201);

    const res = await request(app).get("/api/audit?limit=5").expect(200);
    expect(res.body.events).toBeDefined();
    expect(Array.isArray(res.body.events)).toBe(true);
    expect(res.body.limit).toBe(5);
    expect(res.body.events.length).toBeLessThanOrEqual(5);
  });

  it("audit events filtered by companyId", async () => {
    const { companyId } = await seedCompany();
    // Create another company
    const otherId = newId("company");
    await companies.set({ id: otherId, name: "Other Corp", createdAt: nowIso(), updatedAt: nowIso() });

    await request(app).post("/api/email-drafts").send({ companyId }).expect(201);
    await request(app).post("/api/email-drafts").send({ companyId: otherId }).expect(201);

    const res = await request(app).get(`/api/audit?companyId=${companyId}`).expect(200);
    const allForCompany = res.body.events;
    expect(allForCompany.every((e: { companyId?: string }) => e.companyId === companyId)).toBe(true);
  });

  it("audit endpoint never exposes secrets", async () => {
    const res = await request(app).get("/api/audit").expect(200);
    expect(JSON.stringify(res.body)).not.toMatch(/AIzaSy[A-Za-z0-9_-]{30,}/);
  });
});

describe("Round 4 — Export Manifest Hardening", () => {
  beforeEach(async () => { await clearCollections(); });

  describe("bulk approve eligible", () => {
    beforeEach(async () => { await clearCollections(); });

    function makePerson(personId: string, companyId: string, runId: string, over: Partial<{
      name: string; currentRoles: { title: string; company: string }[];
      mutuals: { name: string }[]; vagueCount: number | null;
    }>): string {
      const now = nowIso();
      extractedPeople.set({
        id: personId, extractionRunId: runId, companyId,
        name: over.name ?? "Test Person", currentRoles: over.currentRoles ?? [],
        pastRoles: [], currentlyAtTargetCompany: true,
        sourceScreenshotIds: [], confidence: 1, createdAt: now,
      });
      for (const m of over.mutuals ?? []) {
        mutualContacts.set({ id: newId("mut"), extractedPersonId: personId, name: m.name, excludedFromEmail: false });
      }
      if (over.vagueCount != null) {
        mutualContacts.set({ id: newId("mut"), extractedPersonId: personId, name: "__vague_count__", excludedFromEmail: true, vagueCount: over.vagueCount });
      }
      return personId;
    }

    it("approves eligible current-company person with named mutual", async () => {
      const { companyId, batchId } = await seedCompany();
      const runId = newId("run");
      await extractionRuns.set({ id: runId, batchId, status: "review_ready", provider: "manual_attach", createdAt: nowIso(), updatedAt: nowIso() });
      const pid = makePerson(newId("person"), companyId, runId, {
        name: "Alice", currentRoles: [{ title: "CTO", company: "Test Corp" }],
        mutuals: [{ name: "Bob" }], vagueCount: null,
      });

      const res = await request(app).post(`/api/reviews/bulk-approve-eligible/${companyId}`).expect(200);
      expect(res.body.approvedCount).toBe(1);
      expect(res.body.skippedCount).toBe(0);
      expect(res.body.approvedPeople[0].id).toBe(pid);

      // Verify review decision was created
      const allReviews = await reviewDecisions.all();
      const personReviews = allReviews.filter((r) => r.extractedPersonId === pid);
      expect(personReviews.length).toBe(1);
      expect(personReviews[0].decision).toBe("approved");
    });

    it("skips person with no mutual contacts", async () => {
      const { companyId, batchId } = await seedCompany();
      const runId = newId("run");
      await extractionRuns.set({ id: runId, batchId, status: "review_ready", provider: "manual_attach", createdAt: nowIso(), updatedAt: nowIso() });
      const pid = makePerson(newId("person"), companyId, runId, {
        name: "Bob", currentRoles: [{ title: "CTO", company: "Test Corp" }],
        mutuals: [], vagueCount: null,
      });

      const res = await request(app).post(`/api/reviews/bulk-approve-eligible/${companyId}`).expect(200);
      expect(res.body.approvedCount).toBe(0);
      expect(res.body.skippedCount).toBe(1);
      expect(res.body.skippedPeople[0].id).toBe(pid);
      expect(res.body.skippedPeople[0].reason).toContain("named mutual");
    });

    it("skips vague-mutual-only person", async () => {
      const { companyId, batchId } = await seedCompany();
      const runId = newId("run");
      await extractionRuns.set({ id: runId, batchId, status: "review_ready", provider: "manual_attach", createdAt: nowIso(), updatedAt: nowIso() });
      const _pid = makePerson(newId("person"), companyId, runId, {
        name: "Carol", currentRoles: [{ title: "CTO", company: "Test Corp" }],
        mutuals: [], vagueCount: 5,
      });

      const res = await request(app).post(`/api/reviews/bulk-approve-eligible/${companyId}`).expect(200);
      expect(res.body.approvedCount).toBe(0);
      expect(res.body.skippedCount).toBe(1);
      expect(res.body.skippedPeople[0].reason).toContain("vague");
    });

    it("skips past-only person", async () => {
      const { companyId, batchId } = await seedCompany();
      const runId = newId("run");
      await extractionRuns.set({ id: runId, batchId, status: "review_ready", provider: "manual_attach", createdAt: nowIso(), updatedAt: nowIso() });
      const _pid = makePerson(newId("person"), companyId, runId, {
        name: "Dan",
        currentRoles: [{ title: "Engineer", company: "Other Corp" }],
        mutuals: [{ name: "Sue" }], vagueCount: null,
      });

      const res = await request(app).post(`/api/reviews/bulk-approve-eligible/${companyId}`).expect(200);
      expect(res.body.approvedCount).toBe(0);
      expect(res.body.skippedCount).toBe(1);
      expect(res.body.skippedPeople[0].reason).toContain("past-only");
    });

    it("skips cross-company person", async () => {
      const { companyId, batchId } = await seedCompany();
      const otherId = newId("company");
      await companies.set({ id: otherId, name: "Other Corp", createdAt: nowIso(), updatedAt: nowIso() });
      const runId = newId("run");
      await extractionRuns.set({ id: runId, batchId, status: "review_ready", provider: "manual_attach", createdAt: nowIso(), updatedAt: nowIso() });
      makePerson(newId("person"), otherId, runId, { // person belongs to OTHER company
        name: "Eve", currentRoles: [{ title: "CTO", company: "Other Corp" }],
        mutuals: [{ name: "Bob" }], vagueCount: null,
      });

      const res = await request(app).post(`/api/reviews/bulk-approve-eligible/${companyId}`).expect(200);
      expect(res.body.approvedCount).toBe(0);
      expect(res.body.skippedCount).toBe(0); // company-scoped means Eve isn't even in company's people
    });

    it("skips already approved person", async () => {
      const { companyId, batchId } = await seedCompany();
      const runId = newId("run");
      await extractionRuns.set({ id: runId, batchId, status: "review_ready", provider: "manual_attach", createdAt: nowIso(), updatedAt: nowIso() });
      const pid = makePerson(newId("person"), companyId, runId, {
        name: "Frank", currentRoles: [{ title: "CTO", company: "Test Corp" }],
        mutuals: [{ name: "Bob" }], vagueCount: null,
      });
      await reviewDecisions.set({ id: newId("rev"), extractedPersonId: pid, decision: "approved", reviewedBy: "Nilhan", decidedAt: nowIso() });

      const res = await request(app).post(`/api/reviews/bulk-approve-eligible/${companyId}`).expect(200);
      expect(res.body.approvedCount).toBe(0);
      expect(res.body.skippedCount).toBe(1);
      expect(res.body.skippedPeople[0].reason).toBe("Already approved");
    });

    it("skips rejected person", async () => {
      const { companyId, batchId } = await seedCompany();
      const runId = newId("run");
      await extractionRuns.set({ id: runId, batchId, status: "review_ready", provider: "manual_attach", createdAt: nowIso(), updatedAt: nowIso() });
      const pid = makePerson(newId("person"), companyId, runId, {
        name: "Grace", currentRoles: [{ title: "CTO", company: "Test Corp" }],
        mutuals: [{ name: "Bob" }], vagueCount: null,
      });
      await reviewDecisions.set({ id: newId("rev"), extractedPersonId: pid, decision: "rejected", reviewedBy: "Nilhan", decidedAt: nowIso() });

      const res = await request(app).post(`/api/reviews/bulk-approve-eligible/${companyId}`).expect(200);
      expect(res.body.approvedCount).toBe(0);
      expect(res.body.skippedCount).toBe(1);
      expect(res.body.skippedPeople[0].reason).toContain("Rejected");
    });

    it("skips needs-review person", async () => {
      const { companyId, batchId } = await seedCompany();
      const runId = newId("run");
      await extractionRuns.set({ id: runId, batchId, status: "review_ready", provider: "manual_attach", createdAt: nowIso(), updatedAt: nowIso() });
      const pid = makePerson(newId("person"), companyId, runId, {
        name: "Heidi", currentRoles: [{ title: "CTO", company: "Test Corp" }],
        mutuals: [{ name: "Bob" }], vagueCount: null,
      });
      await reviewDecisions.set({ id: newId("rev"), extractedPersonId: pid, decision: "needs_review", reviewedBy: "Nilhan", decidedAt: nowIso() });

      const res = await request(app).post(`/api/reviews/bulk-approve-eligible/${companyId}`).expect(200);
      expect(res.body.approvedCount).toBe(0);
      expect(res.body.skippedCount).toBe(1);
      expect(res.body.skippedPeople[0].reason).toContain("needs review");
    });

    it("response includes approved/skipped counts and reasons", async () => {
      const { companyId, batchId } = await seedCompany();
      const runId = newId("run");
      await extractionRuns.set({ id: runId, batchId, status: "review_ready", provider: "manual_attach", createdAt: nowIso(), updatedAt: nowIso() });
      makePerson(newId("person"), companyId, runId, {
        name: "Ivan", currentRoles: [{ title: "CTO", company: "Test Corp" }],
        mutuals: [{ name: "Bob" }], vagueCount: null,
      });
      makePerson(newId("person"), companyId, runId, {
        name: "Jill", currentRoles: [{ title: "CTO", company: "Test Corp" }],
        mutuals: [], vagueCount: 3,
      });

      const res = await request(app).post(`/api/reviews/bulk-approve-eligible/${companyId}`).expect(200);
      expect(res.body.approvedCount).toBe(1);
      expect(res.body.skippedCount).toBe(1);
      expect(res.body.approvedPeople.length).toBe(1);
      expect(res.body.skippedPeople.length).toBe(1);
      expect(res.body.skippedPeople[0].reason).toContain("vague");
    });

    it("audit event written for bulk approval", async () => {
      const { companyId, batchId } = await seedCompany();
      const runId = newId("run");
      await extractionRuns.set({ id: runId, batchId, status: "review_ready", provider: "manual_attach", createdAt: nowIso(), updatedAt: nowIso() });
      makePerson(newId("person"), companyId, runId, {
        name: "Karl", currentRoles: [{ title: "CTO", company: "Test Corp" }],
        mutuals: [{ name: "Bob" }], vagueCount: null,
      });

      await request(app).post(`/api/reviews/bulk-approve-eligible/${companyId}`).expect(200);

      const events = await auditEvents.all();
      const bulkEvents = events.filter((e) => e.eventType === "bulk_approve_completed");
      expect(bulkEvents.length).toBe(1);
      expect(bulkEvents[0].companyId).toBe(companyId);
      expect(bulkEvents[0].detail).toContain("approved=1");
    });

    it("email/export includes approved eligible people after bulk approval", async () => {
      const { companyId, batchId } = await seedCompany();
      const runId = newId("run");
      await extractionRuns.set({ id: runId, batchId, status: "review_ready", provider: "manual_attach", createdAt: nowIso(), updatedAt: nowIso() });
      const pid = makePerson(newId("person"), companyId, runId, {
        name: "Leo", currentRoles: [{ title: "CTO", company: "Test Corp" }],
        mutuals: [{ name: "Bob" }], vagueCount: null,
      });

      // Before bulk approval: email/export should not include Leo
      const emailBefore = await request(app).post("/api/email-drafts").send({ companyId }).expect(201);
      expect(emailBefore.body.personIds).not.toContain(pid);

      // Bulk approve
      await request(app).post(`/api/reviews/bulk-approve-eligible/${companyId}`).expect(200);

      // After bulk approval: email/export should include Leo
      const emailAfter = await request(app).post("/api/email-drafts").send({ companyId }).expect(201);
      expect(emailAfter.body.personIds).toContain(pid);

      const exportAfter = await request(app).post("/api/exports").send({ companyId }).expect(201);
      expect(exportAfter.body.recordCount).toBeGreaterThanOrEqual(1);
    });

    it("email/export still excludes skipped people after bulk approval", async () => {
      const { companyId, batchId } = await seedCompany();
      const runId = newId("run");
      await extractionRuns.set({ id: runId, batchId, status: "review_ready", provider: "manual_attach", createdAt: nowIso(), updatedAt: nowIso() });
      const pidVague = makePerson(newId("person"), companyId, runId, {
        name: "Mia Vague", currentRoles: [{ title: "CTO", company: "Test Corp" }],
        mutuals: [], vagueCount: 5,
      });

      // Bulk approve (vague person should be skipped)
      await request(app).post(`/api/reviews/bulk-approve-eligible/${companyId}`).expect(200);

      // Email should not include the vague-only person
      const email = await request(app).post("/api/email-drafts").send({ companyId }).expect(201);
      expect(email.body.personIds).not.toContain(pidVague);
    });
  });

  it("export manifest includes liveCrmSync=false and companyId", async () => {
    const { companyId } = await seedCompany();
    // Seed an approved person with named mutuals at the target company
    const personId = newId("person");
    const runId = newId("run");
    const now = nowIso();
    await extractionRuns.set({ id: runId, batchId: newId("batch"), status: "review_ready", provider: "manual_attach", createdAt: now, updatedAt: now });
    await extractedPeople.set({
      id: personId, extractionRunId: runId, companyId, name: "Jane Doe",
      currentRoles: [{ title: "CEO", company: "Test Corp" }], pastRoles: [],
      currentlyAtTargetCompany: true, sourceScreenshotIds: [], confidence: 1,
      provenance: "manual_attach", createdAt: now,
    });
    await mutualContacts.set({ id: newId("mut"), extractedPersonId: personId, name: "Mutual Friend", excludedFromEmail: false });
    await reviewDecisions.set({ id: newId("rev"), extractedPersonId: personId, decision: "approved", reviewedBy: "test", decidedAt: now });

    const res = await request(app).post("/api/exports").send({ companyId }).expect(201);
    expect(res.body.recordCount).toBeGreaterThanOrEqual(1);

    // Read the manifest file from disk (response returns repo-root-relative path)
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { PATHS } = await import("../src/config.js");
    const manifestPath = path.join(PATHS.repoRoot, res.body.manifest);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    expect(manifest.liveCrmSync).toBe(false);
    expect(manifest.companyId).toBe(companyId);
    expect(manifest.approvedPersonIds).toContain(personId);
    expect(manifest.fileHashes).toBeDefined();
    expect(manifest.fileHashes.json.sha256).toBeDefined();
    expect(manifest.fileHashes.csv.sha256).toBeDefined();
  });
});
