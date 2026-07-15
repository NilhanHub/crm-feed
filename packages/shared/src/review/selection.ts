import type { ExtractionPerson } from "../schema/extraction.js";
import type { CurrentReviewState } from "../types/entities.js";
import { evaluateEligibility, dedupePeople } from "../rules/eligibility.js";
import { rankPeople, MAX_PEOPLE_PER_EMAIL, MAX_NAMED_MUTUALS_PER_PERSON } from "../rules/ranking.js";
import { isLatestApproved } from "./projection.js";

// Company-scoped target selection helper.
// Selects only:
// - people currently at the selected company
// - with at least one named mutual contact
// - latest review state approved
// - not past-only
// - not rejected/needs-review
// - max 10 people
// - max 7 named mutuals each

export interface SelectionInput {
  people: ExtractionPerson[];
  targetCompanyName: string;
  companyId: string;
  reviewStates: Map<string, CurrentReviewState>;
}

export interface SelectedPerson {
  person: ExtractionPerson;
  eligible: boolean;
  reasons: string[];
  rankScore: number;
  rankTier: string;
  namedMutuals: string[];
  reviewState: CurrentReviewState;
}

export function selectCompanyScopedPeople(input: SelectionInput): SelectedPerson[] {
  const { people, targetCompanyName, reviewStates } = input;

  // 1. Deduplicate
  const { unique } = dedupePeople(people, targetCompanyName);

  // 2. Filter: latest approved, currently at target, has named mutual
  const candidates = unique.filter((person) => {
    const state = reviewStates.get(person.personId);
    if (!isLatestApproved(state)) return false;

    const elig = evaluateEligibility({ person, targetCompanyName });
    if (!elig.eligible) return false;

    return true;
  });

  // 3. Rank
  const ranked = rankPeople(candidates);

  // 4. Cap to 10
  const capped = ranked.slice(0, MAX_PEOPLE_PER_EMAIL);

  return capped.map((scored) => {
    const person = scored.person;
    const elig = evaluateEligibility({ person, targetCompanyName });
    const state = reviewStates.get(person.personId)!;
    const namedMutuals = person.mutualContacts.named
      .map((m) => m.name)
      .slice(0, MAX_NAMED_MUTUALS_PER_PERSON);

    return {
      person,
      eligible: elig.eligible,
      reasons: elig.reasons,
      rankScore: scored.score,
      rankTier: scored.tier,
      namedMutuals,
      reviewState: state,
    };
  });
}

// Count export-ready people for a company (before capping).
export function countExportReady(input: SelectionInput): number {
  const { people, targetCompanyName, reviewStates } = input;
  const { unique } = dedupePeople(people, targetCompanyName);

  return unique.filter((person) => {
    const state = reviewStates.get(person.personId);
    if (!isLatestApproved(state)) return false;
    const elig = evaluateEligibility({ person, targetCompanyName });
    return elig.eligible;
  }).length;
}
