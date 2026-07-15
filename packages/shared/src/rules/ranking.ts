import type { ExtractionPerson } from "../schema/extraction.js";

// Deterministic ranking/scoring for target relevance.
// See docs/ELIGIBILITY_RULES.md "Role prioritisation".

const PRIORITY_TIER1 = ["ceo", "coo", "cto", "cio", "chief executive", "chief operating", "chief technology", "chief information"]; // 130
const PRIORITY_TIER2 = ["head of it", "it director", "director of it", "head of technology", "head of infrastructure"]; // 115
const PRIORITY_TIER3 = [
  "infrastructure", "cyber", "digital", "transformation", "operations",
  "procurement", "vendor", "supplier", "security", "cloud", "data centre", "data center",
]; // 100

const DEPRIORITISED = [
  "hr", "human resources", "marketing", "talent", "comms", "communications",
  "recruiting", "recruitment", "people", "brand", "social",
]; // 10

const NEUTRAL_WEIGHT = 30;

function keywordMatches(haystack: string, keyword: string): boolean {
  if (!haystack) return false;
  // word-boundary match, case-insensitive
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(^|\\b|\\W)${escaped}(\\b|\\W|$)`, "i");
  return re.test(haystack);
}

function personRoleText(person: ExtractionPerson): string {
  const parts: string[] = [];
  if (person.title) parts.push(person.title);
  if (person.headline) parts.push(person.headline);
  for (const r of person.currentRoles) parts.push(r.title);
  return parts.join(" | ");
}

export interface ScoredPerson {
  person: ExtractionPerson;
  score: number;
  matchedKeyword: string | null;
  tier: "priority1" | "priority2" | "priority3" | "deprioritised" | "neutral";
}

export function scorePerson(person: ExtractionPerson): ScoredPerson {
  const text = personRoleText(person);

  let bestWeight = NEUTRAL_WEIGHT;
  let matchedKeyword: string | null = null;
  let tier: ScoredPerson["tier"] = "neutral";

  for (const kw of PRIORITY_TIER1) {
    if (keywordMatches(text, kw)) {
      bestWeight = 130;
      matchedKeyword = kw;
      tier = "priority1";
      break;
    }
  }
  if (tier === "neutral") {
    for (const kw of PRIORITY_TIER2) {
      if (keywordMatches(text, kw)) {
        bestWeight = 115;
        matchedKeyword = kw;
        tier = "priority2";
        break;
      }
    }
  }
  if (tier === "neutral") {
    for (const kw of PRIORITY_TIER3) {
      if (keywordMatches(text, kw)) {
        bestWeight = 100;
        matchedKeyword = kw;
        tier = "priority3";
        break;
      }
    }
  }
  if (tier === "neutral") {
    for (const kw of DEPRIORITISED) {
      if (keywordMatches(text, kw)) {
        bestWeight = 10;
        matchedKeyword = kw;
        tier = "deprioritised";
        break;
      }
    }
  }

  return { person, score: bestWeight, matchedKeyword, tier };
}

// Sort: score desc, then confidence desc, then normalised name asc. Deterministic.
export function rankPeople(people: ExtractionPerson[]): ScoredPerson[] {
  const scored = people.map(scorePerson);
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.person.confidence !== a.person.confidence) {
      return b.person.confidence - a.person.confidence;
    }
    return a.person.name.trim().toLowerCase().localeCompare(b.person.name.trim().toLowerCase());
  });
  return scored;
}

export const MAX_PEOPLE_PER_EMAIL = 10;
export const MAX_NAMED_MUTUALS_PER_PERSON = 7;

export function capPeople(people: ExtractionPerson[]): ExtractionPerson[] {
  return rankPeople(people).slice(0, MAX_PEOPLE_PER_EMAIL).map((s) => s.person);
}

export function capNamedMutuals(names: string[]): string[] {
  return names.slice(0, MAX_NAMED_MUTUALS_PER_PERSON);
}
