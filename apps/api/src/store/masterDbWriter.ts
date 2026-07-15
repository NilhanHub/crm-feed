import { newId, nowIso } from "../util/id.js";
import {
  personObservations,
  employmentObservations,
  mutualConnectionObservations,
  masterPeople,
  screenshots,
  auditEvents,
} from "./db.js";
import {
  normalizePersonName,
  type ExtractedPerson,
  type MutualContact,
  type PersonObservation,
  type EmploymentObservation,
  type MutualConnectionObservation,
  type MasterPerson,
} from "@crm-feed/shared";

/**
 * File observation records from a successful extraction.
 * Creates PersonObservation, EmploymentObservation, and MutualConnectionObservation records
 * with full provenance links to screenshot and extraction run.
 */
export async function fileExtractionObservations(
  extractedPeople: ExtractedPerson[],
  mutualContactsMap: Map<string, MutualContact[]>,
  screenshotId: string,
  extractionRunId: string
): Promise<{ personObservationIds: string[] }> {
  const now = nowIso();
  const personObservationIds: string[] = [];

  for (const ep of extractedPeople) {
    const normalizedName = normalizePersonName(ep.name);
    const evidenceText = `Extracted from screenshot ${screenshotId} via run ${extractionRunId}`;

    // Create PersonObservation
    const obsId = newId("pobs");
    const obs: PersonObservation = {
      id: obsId,
      observedName: ep.name,
      normalizedName,
      headline: ep.headline,
      title: ep.title,
      location: ep.location,
      connectionDegree: ep.connectionDegree,
      currentRoleText: ep.currentRoles[0]?.title,
      currentCompanyName: ep.currentRoles[0]?.company,
      currentCompanyId: ep.companyId,
      pastCompanyNames: ep.pastRoles.map((r) => r.company),
      pastCompanyIds: [],
      sourceScreenshotId: screenshotId,
      extractionRunId,
      confidence: ep.confidence,
      fieldConfidence: ep.fieldConfidence,
      evidenceText,
      extractedPersonId: ep.id,
      createdAt: now,
    };
    await personObservations.set(obs);
    personObservationIds.push(obsId);

    // File EmploymentObservations for current roles
    for (const role of ep.currentRoles) {
      const empObs: EmploymentObservation = {
        id: newId("eobs"),
        personObservationId: obsId,
        companyId: ep.companyId,
        companyNameObserved: role.company,
        roleTitle: role.title,
        status: "current",
        confidence: ep.confidence,
        sourceScreenshotId: screenshotId,
        extractionRunId,
        evidenceText: role.evidenceText,
        createdAt: now,
      };
      await employmentObservations.set(empObs);
    }

    // File EmploymentObservations for past roles
    for (const role of ep.pastRoles) {
      const empObs: EmploymentObservation = {
        id: newId("eobs"),
        personObservationId: obsId,
        companyNameObserved: role.company,
        roleTitle: role.title,
        status: "past",
        confidence: ep.confidence,
        sourceScreenshotId: screenshotId,
        extractionRunId,
        evidenceText: role.evidenceText,
        createdAt: now,
      };
      await employmentObservations.set(empObs);
    }

    // File MutualConnectionObservations
    const mutuals = mutualContactsMap.get(ep.id) ?? [];
    for (const mc of mutuals) {
      if (mc.name === "__vague_count__") {
        // Vague count observation
        const mutObs: MutualConnectionObservation = {
          id: newId("mobs"),
          personObservationId: obsId,
          vagueMutualCount: mc.vagueCount,
          type: "vague_count",
          sourceScreenshotId: screenshotId,
          extractionRunId,
          createdAt: now,
        };
        await mutualConnectionObservations.set(mutObs);
      } else {
        // Named mutual observation
        const mutObs: MutualConnectionObservation = {
          id: newId("mobs"),
          personObservationId: obsId,
          mutualName: mc.name,
          type: "named",
          sourceScreenshotId: screenshotId,
          extractionRunId,
          createdAt: now,
        };
        await mutualConnectionObservations.set(mutObs);
      }
    }
  }

  // Conservative MasterPerson linking: create/update based on normalized name + company
  for (const obsId of personObservationIds) {
    const obs = await personObservations.get(obsId);
    if (!obs) continue;

    const allMaster = await masterPeople.all();

    // Try to find existing MasterPerson with same normalized name + overlapping company
    const matchOptions = [
      // Exact normalized name match + same company
      () =>
        allMaster.find(
          (mp) =>
            mp.normalizedName === obs.normalizedName &&
            mp.companyIds.some((cid) => cid === obs.currentCompanyId)
        ),
      // Exact normalized name match alone (conservative)
      () => allMaster.find((mp) => mp.normalizedName === obs.normalizedName),
    ];

    const match =
      matchOptions.reduce<MasterPerson | undefined>(
        (found, fn) => found ?? fn(),
        undefined
      );

    if (match) {
      // Add observation to existing master person
      if (!match.personObservationIds.includes(obsId)) {
        match.personObservationIds.push(obsId);
      }
      if (obs.extractedPersonId && !match.extractedPersonIds.includes(obs.extractedPersonId)) {
        match.extractedPersonIds.push(obs.extractedPersonId);
      }
      if (obs.currentCompanyId && !match.companyIds.includes(obs.currentCompanyId)) {
        match.companyIds.push(obs.currentCompanyId);
      }
      match.updatedAt = nowIso();
      await masterPeople.set(match);
    } else {
      // Create new MasterPerson
      const newMaster: MasterPerson = {
        id: newId("mp"),
        displayName: obs.observedName,
        normalizedName: obs.normalizedName,
        aliases: [obs.observedName],
        personObservationIds: [obsId],
        extractedPersonIds: obs.extractedPersonId ? [obs.extractedPersonId] : [],
        companyIds: obs.currentCompanyId ? [obs.currentCompanyId] : [],
        mergeStatus: "singleton",
        createdAt: now,
        updatedAt: now,
      };
      await masterPeople.set(newMaster);
    }
  }

  // Audit
  if (personObservationIds.length > 0) {
    await auditEvents.set({
      id: newId("aev"),
      eventType: "master_observation_created",
      screenshotId,
      detail: `${personObservationIds.length} person observation(s), linked employment + mutual observations`,
      actor: "system",
      createdAt: nowIso(),
    });
  }

  return { personObservationIds };
}

/**
 * Backfill observation records from existing extracted people and mutual contacts.
 * Idempotent: skips if observations already exist for a given extraction run.
 */
export async function backfillMasterDb(): Promise<{
  personObservationsCreated: number;
  masterPeopleCreated: number;
}> {
  const existingObs = await personObservations.all();
  const existingExtractedPersonIds = new Set(
    existingObs.map((o) => o.extractedPersonId).filter(Boolean)
  );

  const { extractedPeople: epStore, mutualContacts: mcStore, screenshots: shotStore } = await import("./db.js");

  const allPeople = await epStore.all();
  const allMutuals = await mcStore.all();
  const allShots = await shotStore.all();
  const validShotIds = new Set(allShots.map((s) => s.id));

  // Group mutuals by extracted person ID
  const mutualsByPerson = new Map<string, MutualContact[]>();
  for (const mc of allMutuals) {
    const existing = mutualsByPerson.get(mc.extractedPersonId) ?? [];
    existing.push(mc);
    mutualsByPerson.set(mc.extractedPersonId, existing);
  }

  const now = nowIso();
  let personObsCreated = 0;
  let masterPeopleCreated = 0;

  for (const person of allPeople) {
    if (existingExtractedPersonIds.has(person.id)) continue;
    if (person.sourceScreenshotIds.length === 0) continue;

    const shotId = person.sourceScreenshotIds[0]!;
    if (!validShotIds.has(shotId)) continue;
    const runId = person.extractionRunId;

    {
      const normalizedName = normalizePersonName(person.name);

      const obsId = newId("pobs");
      const obs: PersonObservation = {
        id: obsId,
        observedName: person.name,
        normalizedName,
        headline: person.headline,
        title: person.title,
        location: person.location,
        connectionDegree: person.connectionDegree,
        currentRoleText: person.currentRoles[0]?.title,
        currentCompanyName: person.currentRoles[0]?.company,
        currentCompanyId: person.companyId,
        pastCompanyNames: person.pastRoles.map((r) => r.company),
        pastCompanyIds: [],
        sourceScreenshotId: shotId,
        extractionRunId: runId,
        confidence: person.confidence,
        extractedPersonId: person.id,
        createdAt: now,
      };
      await personObservations.set(obs);

      // Employment observations
      for (const role of person.currentRoles) {
        await employmentObservations.set({
          id: newId("eobs"),
          personObservationId: obsId,
          companyId: person.companyId,
          companyNameObserved: role.company,
          roleTitle: role.title,
          status: "current",
          confidence: person.confidence,
          sourceScreenshotId: shotId,
          extractionRunId: runId,
          createdAt: now,
        });
      }
      for (const role of person.pastRoles) {
        await employmentObservations.set({
          id: newId("eobs"),
          personObservationId: obsId,
          companyNameObserved: role.company,
          roleTitle: role.title,
          status: "past",
          confidence: person.confidence,
          sourceScreenshotId: shotId,
          extractionRunId: runId,
          createdAt: now,
        });
      }

      // Mutual connection observations
      const mutuals = mutualsByPerson.get(person.id) ?? [];
      for (const mc of mutuals) {
        if (mc.name === "__vague_count__") {
          await mutualConnectionObservations.set({
            id: newId("mobs"),
            personObservationId: obsId,
            vagueMutualCount: mc.vagueCount,
            type: "vague_count",
            sourceScreenshotId: shotId,
            extractionRunId: runId,
            createdAt: now,
          });
        } else {
          await mutualConnectionObservations.set({
            id: newId("mobs"),
            personObservationId: obsId,
            mutualName: mc.name,
            type: "named",
            sourceScreenshotId: shotId,
            extractionRunId: runId,
            createdAt: now,
          });
        }
      }

      personObsCreated++;
    }
  }

  // Create MasterPeople from observations
  const allObs = await personObservations.all();
  const existingMaster = await masterPeople.all();
  const existingMasterNames = new Map(existingMaster.map((mp) => [mp.normalizedName, mp]));

  for (const obs of allObs) {
    const match = existingMasterNames.get(obs.normalizedName);
    if (match) {
      if (!match.personObservationIds.includes(obs.id)) {
        match.personObservationIds.push(obs.id);
      }
      if (obs.extractedPersonId && !match.extractedPersonIds.includes(obs.extractedPersonId)) {
        match.extractedPersonIds.push(obs.extractedPersonId);
      }
      if (obs.currentCompanyId && !match.companyIds.includes(obs.currentCompanyId)) {
        match.companyIds.push(obs.currentCompanyId);
      }
      match.updatedAt = nowIso();
      await masterPeople.set(match);
    } else {
      const newMaster: MasterPerson = {
        id: newId("mp"),
        displayName: obs.observedName,
        normalizedName: obs.normalizedName,
        aliases: [obs.observedName],
        personObservationIds: [obs.id],
        extractedPersonIds: obs.extractedPersonId ? [obs.extractedPersonId] : [],
        companyIds: obs.currentCompanyId ? [obs.currentCompanyId] : [],
        mergeStatus: "singleton",
        createdAt: now,
        updatedAt: now,
      };
      await masterPeople.set(newMaster);
      existingMasterNames.set(obs.normalizedName, newMaster);
      masterPeopleCreated++;
    }
  }

  // Update screenshot assignment states
  for (const shot of allShots) {
    if (!shot.assignmentState) {
      const state = shot.needsCompanyReview
        ? "needs_company_review"
        : shot.batchId === "__intake__"
          ? "unassigned"
          : "assigned";
      await screenshots.set({ ...shot, assignmentState: state as "assigned" | "unassigned" | "needs_company_review" });
    }
  }

  return { personObservationsCreated: personObsCreated, masterPeopleCreated };
}
