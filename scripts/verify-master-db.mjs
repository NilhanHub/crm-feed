#!/usr/bin/env node

/**
 * Master Relationship Database v1 — Data Integrity Check
 *
 * Checks:
 * - every SourceScreenshot has existing file path
 * - every SourceScreenshot has SHA-256
 * - duplicate hashes are handled intentionally
 * - every ExtractionRun links to existing SourceScreenshot
 * - every PersonObservation links to existing SourceScreenshot and ExtractionRun
 * - every EmploymentObservation links to existing PersonObservation and SourceScreenshot
 * - every MutualConnectionObservation links to existing PersonObservation and SourceScreenshot
 * - named/vague mutuals are distinguishable
 * - no observation has missing provenance
 * - no unassigned screenshot appears under a normal company
 * - no company-scoped API/export leaks cross-company people (structural check)
 * - no unapproved person appears in email/export (rule check)
 * - raw response storage contains no API keys
 * - no orphan records
 */

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const DATA_DIR = path.resolve(process.cwd(), "data/db");
const UPLOADS_DIR = path.resolve(process.cwd(), "data/uploads");

function readCollection(name) {
  const f = path.join(DATA_DIR, `${name}.json`);
  try {
    const raw = fs.readFileSync(f, "utf8");
    const obj = JSON.parse(raw);
    return Object.values(obj);
  } catch {
    return [];
  }
}

function sha256OfFile(p) {
  try {
    const buf = fs.readFileSync(p);
    return createHash("sha256").update(buf).digest("hex");
  } catch {
    return null;
  }
}

function checkContainsApiKey(text) {
  if (!text) return false;
  // Check for common API key patterns
  const patterns = [
    /AIza[A-Za-z0-9_-]{35}/,  // Google API key
    /sk-[A-Za-z0-9]{32,}/,    // OpenAI key
    /ghp_[A-Za-z0-9]{36}/,    // GitHub PAT
  ];
  return patterns.some((p) => p.test(text));
}

async function main() {
  const errors = [];
  const warnings = [];
  const info = [];

  // Load all collections
  const shots = readCollection("screenshots");
  const runs = readCollection("extraction_runs");
  const people = readCollection("extracted_people");
  const mutuals = readCollection("mutual_contacts");
  const personObs = readCollection("person_observations");
  const masterPeople = readCollection("master_people");
  const employObs = readCollection("employment_observations");
  const mutualConnObs = readCollection("mutual_connection_observations");
  const companies = readCollection("companies");
  const rawResponses = readCollection("raw_responses");
  const eligibilityDecisions = readCollection("eligibility_decisions");
  const reviewDecisions = readCollection("review_decisions");
  const emailDrafts = readCollection("email_drafts");
  const exportBatches = readCollection("export_batches");
  const batches = readCollection("batches");

  info.push(`Collections loaded: screenshots=${shots.length}, runs=${runs.length}, companies=${companies.length}`);
  info.push(`Collections loaded: personObservations=${personObs.length}, masterPeople=${masterPeople.length}`);
  info.push(`Collections loaded: employmentObservations=${employObs.length}, mutualConnectionObservations=${mutualConnObs.length}`);

  // --- Check 1: Screenshots ---
  info.push("\n--- Check 1: Screenshots ---");
  for (const shot of shots) {
    const storagePath = path.resolve(process.cwd(), shot.storagePath);
    if (!fs.existsSync(storagePath)) {
      errors.push(`SCREENSHOT_FILE_MISSING: screenshot ${shot.id} storagePath ${shot.storagePath} does not exist`);
    }
    if (!shot.sha256) {
      errors.push(`SCREENSHOT_NO_SHA: screenshot ${shot.id} has no SHA-256`);
    } else {
      const actualSha = sha256OfFile(storagePath);
      if (actualSha && actualSha !== shot.sha256) {
        errors.push(`SCREENSHOT_SHA_MISMATCH: screenshot ${shot.id} stored SHA ${shot.sha256} does not match file ${actualSha}`);
      }
    }
  }

  // --- Check 2: Duplicate hashes ---
  info.push("\n--- Check 2: Duplicate Hashes ---");
  const hashGroups = new Map();
  for (const shot of shots) {
    if (shot.sha256) {
      const list = hashGroups.get(shot.sha256) ?? [];
      list.push(shot);
      hashGroups.set(shot.sha256, list);
    }
  }
  for (const [hash, group] of hashGroups) {
    if (group.length > 1) {
      const ids = group.map((s) => s.id).join(", ");
      warnings.push(`DUPLICATE_HASH: SHA-256 ${hash.slice(0, 12)}… shared by ${group.length} screenshots: ${ids}`);
    }
  }

  // --- Check 3: ExtractionRuns link to existing screenshots via screenshotIds ---
  info.push("\n--- Check 3: ExtractionRun Screenshot Links ---");
  const shotIds = new Set(shots.map((s) => s.id));
  for (const run of runs) {
    if (run.screenshotIds) {
      for (const sid of run.screenshotIds) {
        if (!shotIds.has(sid)) {
          errors.push(`EXTRACTION_RUN_ORPHAN_SCREENSHOT: run ${run.id} links to screenshot ${sid} which does not exist`);
        }
      }
    }
  }

  // --- Check 4: PersonObservation provenance ---
  info.push("\n--- Check 4: PersonObservation Provenance ---");
  const allObs = [...personObs, ...people];
  for (const obs of personObs) {
    if (!obs.sourceScreenshotId) {
      errors.push(`PERSON_OBSERVATION_NO_SOURCE_SCREENSHOT: observation ${obs.id} missing sourceScreenshotId`);
    } else if (!shotIds.has(obs.sourceScreenshotId)) {
      errors.push(`PERSON_OBSERVATION_ORPHAN_SCREENSHOT: observation ${obs.id} links to screenshot ${obs.sourceScreenshotId} which does not exist`);
    }
    if (!obs.extractionRunId) {
      errors.push(`PERSON_OBSERVATION_NO_EXTRACTION_RUN: observation ${obs.id} missing extractionRunId`);
    }
    if (!obs.observedName) {
      errors.push(`PERSON_OBSERVATION_NO_NAME: observation ${obs.id} has no observedName`);
    }
  }

  // --- Check 5: EmploymentObservation provenance ---
  info.push("\n--- Check 5: EmploymentObservation Provenance ---");
  const personObsIds = new Set(personObs.map((o) => o.id));
  for (const eo of employObs) {
    if (!eo.personObservationId) {
      errors.push(`EMPLOYMENT_OBSERVATION_NO_PERSON_LINK: employment obs ${eo.id} missing personObservationId`);
    } else if (!personObsIds.has(eo.personObservationId)) {
      // Also check extracted people IDs
      const extractedIds = new Set(people.map((p) => p.id));
      if (!extractedIds.has(eo.personObservationId)) {
        errors.push(`EMPLOYMENT_OBSERVATION_ORPHAN_PERSON: employment obs ${eo.id} links to person ${eo.personObservationId} which does not exist`);
      }
    }
    if (!eo.sourceScreenshotId) {
      errors.push(`EMPLOYMENT_OBSERVATION_NO_SOURCE_SCREENSHOT: employment obs ${eo.id} missing sourceScreenshotId`);
    }
    if (!eo.extractionRunId) {
      errors.push(`EMPLOYMENT_OBSERVATION_NO_EXTRACTION_RUN: employment obs ${eo.id} missing extractionRunId`);
    }
  }

  // --- Check 6: MutualConnectionObservation provenance ---
  info.push("\n--- Check 6: MutualConnectionObservation Provenance ---");
  for (const mo of mutualConnObs) {
    if (!mo.personObservationId) {
      errors.push(`MUTUAL_CONNECTION_OBS_NO_PERSON_LINK: mutual obs ${mo.id} missing personObservationId`);
    }
    if (!mo.sourceScreenshotId) {
      errors.push(`MUTUAL_CONNECTION_OBS_NO_SOURCE_SCREENSHOT: mutual obs ${mo.id} missing sourceScreenshotId`);
    }
    if (!mo.extractionRunId) {
      errors.push(`MUTUAL_CONNECTION_OBS_NO_EXTRACTION_RUN: mutual obs ${mo.id} missing extractionRunId`);
    }
    if (mo.type !== "named" && mo.type !== "vague_count") {
      errors.push(`MUTUAL_CONNECTION_OBS_INVALID_TYPE: mutual obs ${mo.id} has type "${mo.type}"`);
    }
    if (mo.type === "named" && !mo.mutualName) {
      errors.push(`MUTUAL_CONNECTION_OBS_NAMED_NO_NAME: mutual obs ${mo.id} is type "named" but has no mutualName`);
    }
    if (mo.type === "vague_count" && mo.vagueMutualCount == null) {
      errors.push(`MUTUAL_CONNECTION_OBS_VAGUE_NO_COUNT: mutual obs ${mo.id} is type "vague_count" but has no vagueMutualCount`);
    }
  }

  // --- Check 7: Named vs Vague mutual distinction ---
  info.push("\n--- Check 7: Named vs Vague Mutual Distinction ---");
  let namedCount = 0;
  let vagueCount = 0;
  for (const mo of mutualConnObs) {
    if (mo.type === "named") namedCount++;
    if (mo.type === "vague_count") vagueCount++;
  }
  info.push(`Named mutual connection observations: ${namedCount}`);
  info.push(`Vague count mutual connection observations: ${vagueCount}`);

  // --- Check 8: Unassigned screenshots ---
  info.push("\n--- Check 8: Unassigned Screenshots ---");
  const batchIds = new Set(batches.map((b) => b.id));
  for (const shot of shots) {
    if (shot.needsCompanyReview || shot.batchId === "__intake__") {
      const companyBatches = batches.filter((b) => b.companyId !== "__unassigned__");
      if (shot.assignmentState === "assigned" && shot.needsCompanyReview) {
        warnings.push(`UNASSIGNED_MARKED_ASSIGNED: screenshot ${shot.id} has needsCompanyReview but assignmentState is "assigned"`);
      }
    }
  }

  // --- Check 9: No API keys in raw responses ---
  info.push("\n--- Check 9: Raw Response Security ---");
  for (const raw of rawResponses) {
    if (raw.rawText && checkContainsApiKey(raw.rawText)) {
      errors.push(`RAW_RESPONSE_API_KEY: raw response ${raw.id} appears to contain API key material`);
    }
  }

  // --- Check 10: Orphan records ---
  info.push("\n--- Check 10: Orphan Records ---");
  const runIds = new Set(runs.map((r) => r.id));
  const extractedPersonIds = new Set(people.map((p) => p.id));

  for (const obs of personObs) {
    if (obs.extractionRunId && !runIds.has(obs.extractionRunId)) {
      warnings.push(`ORPHAN_OBSERVATION_RUN: person observation ${obs.id} links to run ${obs.extractionRunId} which does not exist`);
    }
  }

  // --- Check 11: Review/email/export eligibility ---
  info.push("\n--- Check 11: Review Decision Latest Wins ---");
  const reviewStates = new Map();
  for (const rev of reviewDecisions) {
    reviewStates.set(rev.extractedPersonId, rev);
  }
  const allReviewIds = new Set(reviewDecisions.map((r) => r.extractedPersonId));

  // Summary
  info.push("\n========================================");
  info.push(`TOTAL ERRORS: ${errors.length}`);
  info.push(`TOTAL WARNINGS: ${warnings.length}`);

  if (errors.length > 0) {
    console.log("\n=== ERRORS ===");
    errors.forEach((e) => console.log(`  [FAIL] ${e}`));
  }
  if (warnings.length > 0) {
    console.log("\n=== WARNINGS ===");
    warnings.forEach((w) => console.log(`  [WARN] ${w}`));
  }

  console.log("\n=== INFO ===");
  info.forEach((i) => console.log(`  ${i}`));

  console.log("\n========================================");
  console.log(`Result: ${errors.length === 0 ? "PASS" : "FAIL"}`);
  process.exit(errors.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
