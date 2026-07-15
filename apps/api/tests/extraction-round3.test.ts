import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { setTestProvider } from "../src/routes/extractionRun.js";
import { TestExtractionProvider } from "../src/extraction/gemini.js";
import { newId, nowIso } from "../src/util/id.js";
import {
  companies, batches, screenshots, extractionRuns,
  extractedPeople, mutualContacts, eligibilityDecisions,
  reviewDecisions, crmSyncRecords, emailDrafts,
  exportBatches, extractionAttempts, rawResponses,
} from "../src/store/db.js";

const app = createApp();

// All collections that must be cleared between tests for deterministic isolation.
// Each clear() is routed through the atomic-store per-collection mutex queue so
// it cannot race with a pending write from a prior test (the previous raw
// fs.writeFile approach bypassed the queue and caused intermittent flakiness).
const ALL_COLLECTIONS = [
  companies, batches, screenshots, extractionRuns,
  extractedPeople, mutualContacts, eligibilityDecisions,
  reviewDecisions, crmSyncRecords, emailDrafts,
  exportBatches, extractionAttempts, rawResponses,
];

async function clearCollections() {
  await Promise.all(ALL_COLLECTIONS.map((c) => c.clear()));
}

async function seedData() {
  const companyId = newId("company");
  const batchId = newId("batch");
  const screenshotId = newId("shot");
  const now = nowIso();

  await companies.set({ id: companyId, name: "Test Corp", createdAt: now, updatedAt: now });
  await batches.set({ id: batchId, companyId, status: "open", createdAt: now, updatedAt: now });
  await screenshots.set({
    id: screenshotId, batchId, originalFilename: "test.png",
    storedFilename: "test_stored.png", storagePath: "data/uploads/test.png",
    mimeType: "image/png", sizeBytes: 1000, sha256: "abc123", uploadedAt: now,
  });

  return { companyId, batchId, screenshotId };
}

function validExtractionPayload(): unknown {
  return {
    targetCompanyName: "Test Corp",
    screenshots: [{ screenshotId: "shot_1" }],
    people: [{
      personId: "p1",
      name: "John Doe",
      headline: "CEO at Test Corp",
      title: "CEO",
      location: "London",
      connectionDegree: 2,
      currentRoles: [{ title: "CEO", company: "Test Corp", evidenceText: "CEO at Test Corp" }],
      pastRoles: [],
      mutualContacts: { named: [{ name: "Jane Smith" }], vagueCount: null },
      sourceScreenshotIds: ["shot_1"],
      confidence: 0.95,
      fieldConfidence: { name: 0.95, title: 0.9, location: 0.85, currentRoles: 0.9, mutualContacts: 0.8 },
    }],
    extractionMeta: { provider: "gemini", overallConfidence: 0.9, extractionWarnings: [] },
  };
}

// Sequential: these tests share on-disk JSON collections under data/db/.
// Running them concurrently would let one test's writes race another's clear.
describe("Extraction API — TestExtractionProvider injection", () => {
  beforeEach(async () => {
    await clearCollections();
  });

  afterEach(() => {
    setTestProvider(null);
  });

  it("missing credentials — returns failed with missing_credentials, no people created", async () => {
    setTestProvider(new TestExtractionProvider({ available: false }));
    const { screenshotId } = await seedData();

    const res = await request(app)
      .post(`/api/extraction/extract/${screenshotId}`)
      .expect(200);

    expect(res.body.status).toBe("failed");
    expect(res.body.errorCategory).toBe("missing_credentials");

    const people = await extractedPeople.all();
    expect(people).toHaveLength(0);
  });

  it("malformed output — returns failed with malformed_json, no people created", async () => {
    setTestProvider(new TestExtractionProvider({ responseText: "this is not valid json" }));
    const { screenshotId } = await seedData();

    const res = await request(app)
      .post(`/api/extraction/extract/${screenshotId}`)
      .expect(200);

    expect(res.body.status).toBe("failed");
    expect(res.body.errorCategory).toBe("malformed_json");

    const people = await extractedPeople.all();
    expect(people).toHaveLength(0);
  });

  it("schema validation failure — valid JSON but missing required fields", async () => {
    const badPayload = {
      targetCompanyName: "Test Corp",
      screenshots: [],
      people: [{
        personId: "p1",
        headline: "CEO",
        currentRoles: [],
        pastRoles: [],
        mutualContacts: { named: [], vagueCount: null },
        sourceScreenshotIds: [],
        confidence: 0.9,
      }],
      extractionMeta: { provider: "gemini", overallConfidence: 0.9, extractionWarnings: [] },
    };
    setTestProvider(new TestExtractionProvider({ responseText: JSON.stringify(badPayload) }));
    const { screenshotId } = await seedData();

    const res = await request(app)
      .post(`/api/extraction/extract/${screenshotId}`)
      .expect(200);

    expect(res.body.status).toBe("failed");
    expect(res.body.errorCategory).toBe("schema_validation_failed");

    const people = await extractedPeople.all();
    expect(people).toHaveLength(0);
  });

  it("valid extraction — succeeds, people created and stored in db", async () => {
    setTestProvider(new TestExtractionProvider({ responseText: JSON.stringify(validExtractionPayload()) }));
    const { screenshotId, batchId } = await seedData();

    const res = await request(app)
      .post(`/api/extraction/extract/${screenshotId}`)
      .expect(200);

    expect(res.body.status).toBe("succeeded");
    expect(res.body.peopleCreated).toBeGreaterThan(0);
    expect(res.body.people[0].name).toBe("John Doe");

    const people = await extractedPeople.all();
    expect(people.length).toBeGreaterThan(0);
    expect(people[0].name).toBe("John Doe");

    const runs = await extractionRuns.all();
    expect(runs.length).toBe(1);
    expect(runs[0].status).toBe("review_ready");

    const batch = await batches.get(batchId);
    expect(batch?.status).toBe("extraction_done");
  });

  it("no-bypass-review — people excluded from email/exports until approved", async () => {
    setTestProvider(new TestExtractionProvider({ responseText: JSON.stringify(validExtractionPayload()) }));
    const { screenshotId, companyId } = await seedData();

    const extractRes = await request(app)
      .post(`/api/extraction/extract/${screenshotId}`)
      .expect(200);

    expect(extractRes.body.status).toBe("succeeded");
    const personId = extractRes.body.people[0].id;

    // Before approval: email draft should have no personIds
    const emailBefore = await request(app)
      .post("/api/email-drafts")
      .send({ companyId })
      .expect(201);
    expect(emailBefore.body.personIds).toHaveLength(0);

    // Approve the person
    await request(app)
      .post("/api/reviews")
      .send({ extractedPersonId: personId, decision: "approved" })
      .expect(201);

    // After approval: email draft should include the person
    const emailAfter = await request(app)
      .post("/api/email-drafts")
      .send({ companyId })
      .expect(201);
    expect(emailAfter.body.personIds).toContain(personId);
  });

  it("retry — fails first attempt, succeeds on retry", async () => {
    const { screenshotId } = await seedData();

    // First attempt: fail
    setTestProvider(new TestExtractionProvider({ responseText: "bad json" }));
    const failRes = await request(app)
      .post(`/api/extraction/extract/${screenshotId}`)
      .expect(200);
    expect(failRes.body.status).toBe("failed");

    // Switch provider to succeed
    setTestProvider(new TestExtractionProvider({ responseText: JSON.stringify(validExtractionPayload()) }));

    // Retry endpoint redirects (308), then extract with force=true follows
    const redirectRes = await request(app)
      .post(`/api/extraction/retry/${screenshotId}`)
      .redirects(0)
      .expect(308);
    expect(redirectRes.headers.location).toContain(`/api/extraction/extract/${screenshotId}`);

    // Manually follow the redirect to the extract endpoint with force=true
    const retryRes = await request(app)
      .post(redirectRes.headers.location)
      .expect(200);

    expect(retryRes.body.status).toBe("succeeded");
    expect(retryRes.body.peopleCreated).toBeGreaterThan(0);

    // Verify attempt history has both the original (now retrying) and succeeded
    const historyRes = await request(app)
      .get(`/api/extraction/attempts/screenshot/${screenshotId}`)
      .expect(200);

    const attempts = historyRes.body.attempts;
    expect(attempts.length).toBeGreaterThanOrEqual(2);
    expect(attempts.some((a: { status: string }) => a.status === "retrying")).toBe(true);
    expect(attempts.some((a: { status: string }) => a.status === "succeeded")).toBe(true);
  });

  it("batch extraction — all screenshots in batch get an attempt", async () => {
    setTestProvider(new TestExtractionProvider({ responseText: JSON.stringify(validExtractionPayload()) }));
    const { batchId } = await seedData();

    const now = nowIso();
    const shot2Id = newId("shot");
    await screenshots.set({
      id: shot2Id, batchId, originalFilename: "test2.png",
      storedFilename: "test2_stored.png", storagePath: "data/uploads/test2.png",
      mimeType: "image/png", sizeBytes: 2000, sha256: "def456", uploadedAt: now,
    });

    const res = await request(app)
      .post(`/api/extraction/extract-batch/${batchId}`)
      .expect(200);

    expect(res.body.batchId).toBe(batchId);
    expect(res.body.totalScreenshots).toBe(2);
    expect(res.body.results).toHaveLength(2);
    for (const result of res.body.results) {
      expect(result.status).toBe("succeeded");
    }
  });

  it("attempt history — returns attempts after extraction", async () => {
    setTestProvider(new TestExtractionProvider({ responseText: JSON.stringify(validExtractionPayload()) }));
    const { screenshotId } = await seedData();

    await request(app)
      .post(`/api/extraction/extract/${screenshotId}`)
      .expect(200);

    const res = await request(app)
      .get(`/api/extraction/attempts/screenshot/${screenshotId}`)
      .expect(200);

    expect(res.body.screenshotId).toBe(screenshotId);
    expect(res.body.attempts).toHaveLength(1);
    expect(res.body.attempts[0].screenshotId).toBe(screenshotId);
    expect(res.body.attempts[0].status).toBe("succeeded");
  });
});
