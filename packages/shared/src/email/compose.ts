import type { ExtractionPerson } from "../schema/extraction.js";
import {
  evaluateEligibility,
  dedupePeople,
  computeCurrentlyAtTarget,
} from "../rules/eligibility.js";
import { rankPeople, MAX_PEOPLE_PER_EMAIL } from "../rules/ranking.js";
import type { EmailDraftPerson } from "./formatter.js";

// Compose formatter-ready people from extraction people + target company +
// the set of approved person ids. Applies eligibility, dedupe, ranking, caps.
// This is the bridge between the extraction payload and the email formatter.

export interface ComposeInput {
  people: ExtractionPerson[];
  targetCompanyName: string;
  approvedPersonIds: Set<string>;
}

function toEmailPerson(
  person: ExtractionPerson,
  targetCompanyName: string,
  approved: boolean
): EmailDraftPerson {
  return {
    id: person.personId,
    name: person.name,
    title: person.title ?? undefined,
    headline: person.headline ?? undefined,
    location: person.location ?? undefined,
    currentlyAtTargetCompany: computeCurrentlyAtTarget(person, targetCompanyName),
    approved,
    currentRoles: person.currentRoles,
    namedMutuals: person.mutualContacts.named.map((m) => m.name),
    vagueMutualCount: person.mutualContacts.vagueCount ?? undefined,
  };
}

export function composeEmailPeople(input: ComposeInput): EmailDraftPerson[] {
  const { people, targetCompanyName, approvedPersonIds } = input;

  const { unique } = dedupePeople(people, targetCompanyName);

  const eligible = unique.filter((p) => {
    const result = evaluateEligibility({ person: p, targetCompanyName });
    return result.eligible;
  });

  const ranked = rankPeople(eligible)
    .slice(0, MAX_PEOPLE_PER_EMAIL)
    .map((s) => s.person);

  return ranked.map((p) =>
    toEmailPerson(p, targetCompanyName, approvedPersonIds.has(p.personId))
  );
}
