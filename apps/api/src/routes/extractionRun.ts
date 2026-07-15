import { Router } from "express";
import path from "node:path";
import { execSync } from "node:child_process";
import {
  companies,
  batches,
  screenshots,
  extractionRuns,
  extractedPeople,
  mutualContacts,
  eligibilityDecisions,
  extractionAttempts,
  rawResponses,
} from "../store/db.js";
import { PATHS } from "../config.js";
import { newId, nowIso } from "../util/id.js";
import { fileExtractionObservations } from "../store/masterDbWriter.js";
import {
  evaluateEligibility,
  computeCurrentlyAtTarget,
  RULES_VERSION,
  EXTRACTION_SCHEMA_VERSION,
  type ExtractionPayload,
  type ExtractionErrorCategory,
  type GeminiExtractionAttempt,
  type RawResponse,
} from "@crm-feed/shared";
import {
  GeminiExtractionProvider,
  type IExtractionProvider,
  type ExtractionRequest,
  type ExtractionServiceResult,
} from "../extraction/gemini.js";
import { GEMINI_PROMPT_VERSION } from "../extraction/prompt.js";
import { writeAudit } from "../audit/writer.js";

export const extractionRunRouter = Router();

// Provider registry — allows dependency injection for tests.
// In production, uses the real GeminiExtractionProvider.
// In tests, a TestExtractionProvider can be injected via the TEST_PROVIDER header.
let testProvider: IExtractionProvider | null = null;

export function setTestProvider(provider: IExtractionProvider | null): void {
  testProvider = provider;
}

function getProvider(): IExtractionProvider {
  if (testProvider) return testProvider;
  return new GeminiExtractionProvider();
}

function getAppCommit(): string | undefined {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  } catch {
    return undefined;
  }
}

const MAX_RAW_RESPONSE_SIZE = 256 * 1024; // 256KB max for stored raw responses

// --- Extract one screenshot (item 19) ---
extractionRunRouter.post("/extract/:screenshotId", async (req, res) => {
  const screenshot = await screenshots.get(req.params.screenshotId);
  if (!screenshot) return res.status(404).json({ error: "screenshot_not_found" });

  const batch = await batches.get(screenshot.batchId);
  if (!batch) return res.status(404).json({ error: "batch_not_found" });
  const company = await companies.get(batch.companyId);
  if (!company) return res.status(404).json({ error: "company_not_found" });

  // Find or create extraction run for this batch
  const allRuns = await extractionRuns.all();
  let run = allRuns.find((r) => r.batchId === batch.id);
  if (!run) {
    run = {
      id: newId("run"),
      batchId: batch.id,
      status: "pending_extraction",
      provider: "gemini",
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    await extractionRuns.set(run);
  }

  const force = req.query.force === "true" || req.body?.force === true;

  // Check if this screenshot already has a successful attempt (unless forced)
  if (!force) {
    const allAttempts = await extractionAttempts.all();
    const existingSuccess = allAttempts.find(
      (a) => a.screenshotId === screenshot.id && a.status === "succeeded"
    );
    if (existingSuccess) {
      return res.json({
        screenshotId: screenshot.id,
        status: "already_succeeded",
        attemptId: existingSuccess.id,
        message: "Screenshot already extracted successfully. Use ?force=true to re-extract.",
      });
    }
  }

  // Create extraction attempt
  const attemptId = newId("att");
  const allAttempts = await extractionAttempts.all();
  const retryCount = allAttempts.filter((a) => a.screenshotId === screenshot.id).length;

  const attempt: GeminiExtractionAttempt = {
    id: attemptId,
    screenshotId: screenshot.id,
    extractionRunId: run.id,
    batchId: batch.id,
    companyId: company.id,
    status: "running",
    retryCount,
    modelUsed: undefined,
    promptVersion: GEMINI_PROMPT_VERSION,
    extractionSchemaVersion: EXTRACTION_SCHEMA_VERSION,
    rulesVersion: RULES_VERSION,
    appCommit: getAppCommit(),
    startedAt: nowIso(),
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  await extractionAttempts.set(attempt);

  await writeAudit({
    eventType: "gemini_extraction_attempted",
    companyId: company.id,
    batchId: batch.id,
    screenshotId: screenshot.id,
    attemptId,
    detail: `retryCount=${retryCount} force=${force}`,
  });

  // Run extraction
  const provider = getProvider();
  const screenshotPath = path.join(PATHS.repoRoot, screenshot.storagePath);
  const request: ExtractionRequest = {
    screenshotPath,
    screenshotId: screenshot.id,
    mimeType: screenshot.mimeType,
    targetCompanyName: company.name,
    extractionRunId: run.id,
    batchId: batch.id,
    companyId: company.id,
  };

  const result: ExtractionServiceResult = await provider.extract(request, {});

  // Update attempt with result
  const completedAt = nowIso();
  if (result.success && result.payload) {
    // Store raw response (sanitized, no secrets)
    const rawText = result.rawResponseText ?? "";
    const truncated = rawText.length > MAX_RAW_RESPONSE_SIZE;
    const storedText = truncated ? rawText.slice(0, MAX_RAW_RESPONSE_SIZE) + "\n[TRUNCATED]" : rawText;

    const rawResponse: RawResponse = {
      id: newId("raw"),
      extractionAttemptId: attemptId,
      screenshotId: screenshot.id,
      provider: "gemini",
      rawText: storedText,
      responseSize: rawText.length,
      truncated,
      storedAt: completedAt,
    };
    await rawResponses.set(rawResponse);

    // Materialize extracted people
    const payload = result.payload as ExtractionPayload;
    const peopleCreated = [];
    for (const person of payload.people) {
      const personId = newId("person");
      const currentlyAtTarget = computeCurrentlyAtTarget(person, company.name);
      const extractedPerson = {
        id: personId,
        extractionRunId: run.id,
        extractionAttemptId: attemptId,
        companyId: company.id,
        name: person.name,
        headline: person.headline ?? undefined,
        title: person.title ?? undefined,
        location: person.location ?? undefined,
        connectionDegree: person.connectionDegree,
        currentRoles: person.currentRoles,
        pastRoles: person.pastRoles,
        currentlyAtTargetCompany: currentlyAtTarget,
        sourceScreenshotIds: person.sourceScreenshotIds.length > 0 ? person.sourceScreenshotIds : [screenshot.id],
        confidence: person.confidence,
        fieldConfidence: person.fieldConfidence
          ? {
              name: person.fieldConfidence.name ?? undefined,
              title: person.fieldConfidence.title ?? undefined,
              location: person.fieldConfidence.location ?? undefined,
              currentRoles: person.fieldConfidence.currentRoles ?? undefined,
              mutualContacts: person.fieldConfidence.mutualContacts ?? undefined,
            }
          : undefined,
        provenance: "gemini" as const,
        createdAt: completedAt,
      };
      await extractedPeople.set(extractedPerson);

      // Named mutuals
      for (const named of person.mutualContacts.named) {
        await mutualContacts.set({
          id: newId("mut"),
          extractedPersonId: personId,
          name: named.name,
          headline: named.headline ?? undefined,
          vagueCount: undefined,
          excludedFromEmail: false,
        });
      }
      // Vague count
      if (person.mutualContacts.vagueCount != null) {
        await mutualContacts.set({
          id: newId("mut"),
          extractedPersonId: personId,
          name: "__vague_count__",
          headline: undefined,
          vagueCount: person.mutualContacts.vagueCount,
          excludedFromEmail: true,
        });
      }

      // Eligibility
      const elig = evaluateEligibility({ person, targetCompanyName: company.name });
      await eligibilityDecisions.set({
        id: `elig_${personId}`,
        extractedPersonId: personId,
        eligible: elig.eligible,
        reasons: elig.reasons,
        computedAt: completedAt,
      });

      peopleCreated.push(extractedPerson);
    }

    // File observations into Master DB
    const allMutualsForObs = await mutualContacts.all();
    const mutualsByPerson = new Map<string, import("@crm-feed/shared").MutualContact[]>();
    for (const mc of allMutualsForObs) {
      const list = mutualsByPerson.get(mc.extractedPersonId) ?? [];
      list.push(mc);
      mutualsByPerson.set(mc.extractedPersonId, list);
    }
    await fileExtractionObservations(peopleCreated, mutualsByPerson, screenshot.id, run.id);

    // Update screenshot with extraction run link
    if (!screenshot.extractionRunIds?.includes(run.id)) {
      const shotRuns = [...(screenshot.extractionRunIds ?? []), run.id];
      await screenshots.set({ ...screenshot, extractionRunIds: shotRuns });
    }

    // Update attempt to succeeded
    const succeededAttempt: GeminiExtractionAttempt = {
      ...attempt,
      status: "succeeded",
      modelUsed: result.modelUsed,
      completedAt,
      updatedAt: completedAt,
    };
    await extractionAttempts.set(succeededAttempt);

    // Update run to review_ready with screenshot link
    const runShotIds = [...(run.screenshotIds ?? []), screenshot.id];
    await extractionRuns.update(run.id, { status: "review_ready", screenshotIds: runShotIds, updatedAt: completedAt });
    await batches.update(batch.id, { status: "extraction_done", updatedAt: completedAt });

    await writeAudit({
      eventType: "gemini_extraction_succeeded",
      companyId: company.id,
      batchId: batch.id,
      screenshotId: screenshot.id,
      attemptId,
      detail: `${peopleCreated.length} person(s) extracted via ${result.modelUsed}`,
    });

    res.status(200).json({
      screenshotId: screenshot.id,
      attemptId,
      status: "succeeded",
      modelUsed: result.modelUsed,
      peopleCreated: peopleCreated.length,
      people: peopleCreated.map((p) => ({ id: p.id, name: p.name, confidence: p.confidence })),
    });
  } else {
    // Failed
    const error = result.error!;
    const failedAttempt: GeminiExtractionAttempt = {
      ...attempt,
      status: "failed",
      errorCategory: error.category as ExtractionErrorCategory,
      errorMessage: error.message,
      modelUsed: result.modelUsed,
      completedAt,
      updatedAt: completedAt,
    };
    await extractionAttempts.set(failedAttempt);

    await writeAudit({
      eventType: "gemini_extraction_failed",
      companyId: company.id,
      batchId: batch.id,
      screenshotId: screenshot.id,
      attemptId,
      detail: `errorCategory=${error.category} retryable=${error.retryable}`,
    });

    // Store raw response even on failure (for debugging)
    if (result.rawResponseText) {
      const rawText = result.rawResponseText;
      const truncated = rawText.length > MAX_RAW_RESPONSE_SIZE;
      const storedText = truncated ? rawText.slice(0, MAX_RAW_RESPONSE_SIZE) + "\n[TRUNCATED]" : rawText;
      const rawResponse: RawResponse = {
        id: newId("raw"),
        extractionAttemptId: attemptId,
        screenshotId: screenshot.id,
        provider: "gemini",
        rawText: storedText,
        responseSize: rawText.length,
        truncated,
        storedAt: completedAt,
      };
      await rawResponses.set(rawResponse);
    }

    res.status(200).json({
      screenshotId: screenshot.id,
      attemptId,
      status: "failed",
      errorCategory: error.category,
      errorMessage: error.message,
      retryable: error.retryable,
    });
  }
});

// --- Extract batch (item 20) ---
extractionRunRouter.post("/extract-batch/:batchId", async (req, res) => {
  const batch = await batches.get(req.params.batchId);
  if (!batch) return res.status(404).json({ error: "batch_not_found" });
  const company = await companies.get(batch.companyId);
  if (!company) return res.status(404).json({ error: "company_not_found" });

  const force = req.query.force === "true" || req.body?.force === true;
  const allShots = await screenshots.all();
  const batchShots = allShots.filter((s) => s.batchId === batch.id);
  const allAttempts = await extractionAttempts.all();

  const results: Array<{
    screenshotId: string;
    status: string;
    attemptId?: string;
    peopleCreated?: number;
    errorCategory?: string;
    errorMessage?: string;
  }> = [];

  for (const shot of batchShots) {
    // Skip already successful unless forced
    if (!force) {
      const existingSuccess = allAttempts.find(
        (a) => a.screenshotId === shot.id && a.status === "succeeded"
      );
      if (existingSuccess) {
        results.push({
          screenshotId: shot.id,
          status: "skipped_already_succeeded",
          attemptId: existingSuccess.id,
        });
        continue;
      }
    }

    // Call extract for each screenshot
    try {
      const provider = getProvider();
      const screenshotPath = path.join(PATHS.repoRoot, shot.storagePath);
      const request: ExtractionRequest = {
        screenshotPath,
        screenshotId: shot.id,
        mimeType: shot.mimeType,
        targetCompanyName: company.name,
        extractionRunId: "",
        batchId: batch.id,
        companyId: company.id,
      };

      const attemptId = newId("att");
      const retryCount = allAttempts.filter((a) => a.screenshotId === shot.id).length;
      const attempt: GeminiExtractionAttempt = {
        id: attemptId,
        screenshotId: shot.id,
        extractionRunId: "",
        batchId: batch.id,
        companyId: company.id,
        status: "running",
        retryCount,
        promptVersion: GEMINI_PROMPT_VERSION,
        extractionSchemaVersion: EXTRACTION_SCHEMA_VERSION,
        rulesVersion: RULES_VERSION,
        appCommit: getAppCommit(),
        startedAt: nowIso(),
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      await extractionAttempts.set(attempt);

      const result = await provider.extract(request, {});
      const completedAt = nowIso();

      if (result.success && result.payload) {
        // Find/create run
        const allRuns = await extractionRuns.all();
        let run = allRuns.find((r) => r.batchId === batch.id);
        if (!run) {
          run = {
            id: newId("run"),
            batchId: batch.id,
            status: "review_ready",
            provider: "gemini",
            createdAt: completedAt,
            updatedAt: completedAt,
          };
          await extractionRuns.set(run);
        }

        const payload = result.payload as ExtractionPayload;
        let peopleCount = 0;
        for (const person of payload.people) {
          const personId = newId("person");
          const currentlyAtTarget = computeCurrentlyAtTarget(person, company.name);
          await extractedPeople.set({
            id: personId,
            extractionRunId: run.id,
            extractionAttemptId: attemptId,
            companyId: company.id,
            name: person.name,
            headline: person.headline ?? undefined,
            title: person.title ?? undefined,
            location: person.location ?? undefined,
            connectionDegree: person.connectionDegree,
            currentRoles: person.currentRoles,
            pastRoles: person.pastRoles,
            currentlyAtTargetCompany: currentlyAtTarget,
            sourceScreenshotIds: person.sourceScreenshotIds.length > 0 ? person.sourceScreenshotIds : [shot.id],
            confidence: person.confidence,
            fieldConfidence: person.fieldConfidence
              ? {
                  name: person.fieldConfidence.name ?? undefined,
                  title: person.fieldConfidence.title ?? undefined,
                  location: person.fieldConfidence.location ?? undefined,
                  currentRoles: person.fieldConfidence.currentRoles ?? undefined,
                  mutualContacts: person.fieldConfidence.mutualContacts ?? undefined,
                }
              : undefined,
            provenance: "gemini",
            createdAt: completedAt,
          });

          for (const named of person.mutualContacts.named) {
            await mutualContacts.set({
              id: newId("mut"),
              extractedPersonId: personId,
              name: named.name,
              headline: named.headline ?? undefined,
              vagueCount: undefined,
              excludedFromEmail: false,
            });
          }
          if (person.mutualContacts.vagueCount != null) {
            await mutualContacts.set({
              id: newId("mut"),
              extractedPersonId: personId,
              name: "__vague_count__",
              headline: undefined,
              vagueCount: person.mutualContacts.vagueCount,
              excludedFromEmail: true,
            });
          }

          const elig = evaluateEligibility({ person, targetCompanyName: company.name });
          await eligibilityDecisions.set({
            id: `elig_${personId}`,
            extractedPersonId: personId,
            eligible: elig.eligible,
            reasons: elig.reasons,
            computedAt: completedAt,
          });
          peopleCount++;
        }

        await extractionAttempts.set({
          ...attempt,
          extractionRunId: run.id,
          status: "succeeded",
          modelUsed: result.modelUsed,
          completedAt,
          updatedAt: completedAt,
        });

        results.push({ screenshotId: shot.id, status: "succeeded", attemptId, peopleCreated: peopleCount });
      } else {
        const error = result.error!;
        await extractionAttempts.set({
          ...attempt,
          status: "failed",
          errorCategory: error.category as ExtractionErrorCategory,
          errorMessage: error.message,
          modelUsed: result.modelUsed,
          completedAt,
          updatedAt: completedAt,
        });
        results.push({
          screenshotId: shot.id,
          status: "failed",
          attemptId,
          errorCategory: error.category,
          errorMessage: error.message,
        });
      }
    } catch (e) {
      results.push({
        screenshotId: shot.id,
        status: "failed",
        errorCategory: "unknown",
        errorMessage: (e as Error).message,
      });
    }
  }

  res.status(200).json({
    batchId: batch.id,
    totalScreenshots: batchShots.length,
    results,
  });
});

// --- Retry failed extraction (item 21) ---
extractionRunRouter.post("/retry/:screenshotId", async (req, res) => {
  const screenshot = await screenshots.get(req.params.screenshotId);
  if (!screenshot) return res.status(404).json({ error: "screenshot_not_found" });

  // Redirect to extract with force
  const allAttempts = await extractionAttempts.all();
  const previousFailures = allAttempts.filter(
    (a) => a.screenshotId === screenshot.id && a.status === "failed"
  );

  if (previousFailures.length === 0) {
    return res.status(400).json({
      error: "no_failed_attempts",
      message: "No failed attempts to retry. Use the extract endpoint instead.",
    });
  }

  // Update latest failed attempt to retrying
  const latestFailure = previousFailures[previousFailures.length - 1]!;
  await extractionAttempts.update(latestFailure.id, {
    status: "retrying",
    updatedAt: nowIso(),
  });

  // Call extract with force
  res.redirect(308, `/api/extraction/extract/${screenshot.id}?force=true`);
});

// --- Attempt history (item 22) ---
extractionRunRouter.get("/attempts/screenshot/:screenshotId", async (req, res) => {
  const allAttempts = await extractionAttempts.all();
  const attempts = allAttempts
    .filter((a) => a.screenshotId === req.params.screenshotId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  res.json({ screenshotId: req.params.screenshotId, attempts });
});

extractionRunRouter.get("/attempts/batch/:batchId", async (req, res) => {
  const allAttempts = await extractionAttempts.all();
  const allShots = await screenshots.all();
  const batchShotIds = new Set(allShots.filter((s) => s.batchId === req.params.batchId).map((s) => s.id));
  const attempts = allAttempts
    .filter((a) => batchShotIds.has(a.screenshotId))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  res.json({ batchId: req.params.batchId, attempts });
});

extractionRunRouter.get("/attempts/:attemptId", async (req, res) => {
  const attempt = await extractionAttempts.get(req.params.attemptId);
  if (!attempt) return res.status(404).json({ error: "attempt_not_found" });
  // Also get the raw response if available
  const allRaw = await rawResponses.all();
  const raw = allRaw.find((r) => r.extractionAttemptId === attempt.id);
  res.json({
    attempt,
    rawResponse: raw ? {
      id: raw.id,
      provider: raw.provider,
      responseSize: raw.responseSize,
      truncated: raw.truncated,
      storedAt: raw.storedAt,
      // Do not return full rawText in list view — use dedicated endpoint
    } : null,
  });
});

// Get full raw response (for audit)
extractionRunRouter.get("/attempts/:attemptId/raw", async (req, res) => {
  const attempt = await extractionAttempts.get(req.params.attemptId);
  if (!attempt) return res.status(404).json({ error: "attempt_not_found" });
  const allRaw = await rawResponses.all();
  const raw = allRaw.find((r) => r.extractionAttemptId === attempt.id);
  if (!raw) return res.status(404).json({ error: "raw_response_not_found" });
  res.json(raw);
});
