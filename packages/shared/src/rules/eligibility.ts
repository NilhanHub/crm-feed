import type { ExtractionPerson } from "../schema/extraction.js";
import {
  isCompanyMatch,
  roleMatchesTargetCompany,
  normalizePersonName,
  personDedupKey,
} from "./normalize.js";

// Deterministic eligibility engine. See docs/ELIGIBILITY_RULES.md.
// Given identical inputs, output is always identical.

export interface EligibilityInput {
  person: ExtractionPerson;
  targetCompanyName: string;
}

export interface EligibilityResult {
  eligible: boolean;
  reasons: string[];
  currentlyAtTargetCompany: boolean;
  hasNamedMutual: boolean;
  namedMutualCount: number;
  hasVagueOnly: boolean;
  dedupKey: string;
}

export function computeCurrentlyAtTarget(
  person: ExtractionPerson,
  targetCompanyName: string
): boolean {
  return person.currentRoles.some((r) => roleMatchesTargetCompany(r, targetCompanyName));
}

export function evaluateEligibility(input: EligibilityInput): EligibilityResult {
  const { person, targetCompanyName } = input;
  const reasons: string[] = [];

  const currentlyAtTargetCompany = computeCurrentlyAtTarget(person, targetCompanyName);
  if (!currentlyAtTargetCompany) {
    reasons.push("past-only: no current role at target company");
  }

  const namedMutualCount = person.mutualContacts.named.length;
  const hasNamedMutual = namedMutualCount > 0;
  const hasVagueOnly = !hasNamedMutual && person.mutualContacts.vagueCount != null;
  if (!hasNamedMutual) {
    if (hasVagueOnly) {
      reasons.push("no named mutual contact (only vague count, which is excluded)");
    } else {
      reasons.push("no named mutual contact");
    }
  }

  const eligible = currentlyAtTargetCompany && hasNamedMutual;
  if (eligible) {
    reasons.push("currently at target company with at least one named mutual");
  }

  return {
    eligible,
    reasons,
    currentlyAtTargetCompany,
    hasNamedMutual,
    namedMutualCount,
    hasVagueOnly,
    dedupKey: personDedupKey(person.name, targetCompanyName),
  };
}

export interface DedupResult {
  unique: ExtractionPerson[];
  duplicatesRemoved: { kept: ExtractionPerson; dropped: ExtractionPerson }[];
}

// De-duplicate people by normalised name + target company, keeping higher confidence.
export function dedupePeople(
  people: ExtractionPerson[],
  targetCompanyName: string
): DedupResult {
  const map = new Map<string, ExtractionPerson>();
  const duplicatesRemoved: { kept: ExtractionPerson; dropped: ExtractionPerson }[] = [];

  for (const person of people) {
    const key = personDedupKey(person.name, targetCompanyName);
    const existing = map.get(key);
    if (!existing) {
      map.set(key, person);
      continue;
    }
    if (person.confidence > existing.confidence) {
      duplicatesRemoved.push({ kept: person, dropped: existing });
      map.set(key, person);
    } else {
      duplicatesRemoved.push({ kept: existing, dropped: person });
    }
  }

  return { unique: Array.from(map.values()), duplicatesRemoved };
}

export function isCompanyMatchExposed(a: string, b: string): boolean {
  return isCompanyMatch(a, b);
}

export { normalizePersonName };
