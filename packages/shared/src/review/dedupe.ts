import type { ExtractionPerson } from "../schema/extraction.js";
import { normalizePersonName, normalizeCompanyName } from "../rules/normalize.js";

// Duplicate candidate detection helpers.
// Strategy: normalised full name + normalised current company + normalised title/headline.
// Duplicates are FLAGGED for review, not silently deleted.
// Source screenshot IDs are preserved on all candidates.

export interface DuplicateCandidate {
  key: string;
  people: ExtractionPerson[];
}

export interface DuplicateDetectionResult {
  unique: ExtractionPerson[];
  duplicateGroups: DuplicateCandidate[];
  flaggedPersonIds: string[];
}

export function dedupeKey(person: ExtractionPerson, targetCompanyName: string): string {
  const name = normalizePersonName(person.name);
  const company = normalizeCompanyName(targetCompanyName);
  const titleSource = person.title ?? person.headline ?? "";
  const title = titleSource.trim().toLowerCase().replace(/\s+/g, " ");
  return `${name}::${company}::${title}`;
}

export function detectDuplicates(
  people: ExtractionPerson[],
  targetCompanyName: string
): DuplicateDetectionResult {
  const groups = new Map<string, ExtractionPerson[]>();

  for (const person of people) {
    const key = dedupeKey(person, targetCompanyName);
    const arr = groups.get(key) ?? [];
    arr.push(person);
    groups.set(key, arr);
  }

  const unique: ExtractionPerson[] = [];
  const duplicateGroups: DuplicateCandidate[] = [];
  const flaggedPersonIds: string[] = [];

  for (const [, group] of groups) {
    if (group.length > 1) {
      // Flag all as duplicates for review; keep highest confidence as the "primary"
      duplicateGroups.push({ key: groups.keys().next().value ?? "", people: group });
      for (const p of group) {
        flaggedPersonIds.push(p.personId);
      }
      // Keep the highest-confidence one as unique
      const best = group.reduce((a, b) =>
        a.confidence >= b.confidence ? a : b
      );
      unique.push(best);
    } else {
      unique.push(group[0]!);
    }
  }

  return { unique, duplicateGroups, flaggedPersonIds };
}

// Looser matching: just normalised name + company (ignores title).
// Useful for finding likely duplicates where title differs slightly.
export function nameCompanyKey(person: ExtractionPerson, targetCompanyName: string): string {
  const name = normalizePersonName(person.name);
  const company = normalizeCompanyName(targetCompanyName);
  return `${name}::${company}`;
}

export function detectNameCompanyDuplicates(
  people: ExtractionPerson[],
  targetCompanyName: string
): DuplicateCandidate[] {
  const groups = new Map<string, ExtractionPerson[]>();
  for (const person of people) {
    const key = nameCompanyKey(person, targetCompanyName);
    const arr = groups.get(key) ?? [];
    arr.push(person);
    groups.set(key, arr);
  }

  const result: DuplicateCandidate[] = [];
  for (const [key, group] of groups) {
    if (group.length > 1) {
      result.push({ key, people: group });
    }
  }
  return result;
}
