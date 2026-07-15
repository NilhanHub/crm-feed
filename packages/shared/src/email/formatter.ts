import type { RoleEntry } from "../types/entities.js";
import { MAX_NAMED_MUTUALS_PER_PERSON, MAX_PEOPLE_PER_EMAIL } from "../rules/ranking.js";

// Plain-text email formatter. See docs/MASTER_SPEC.md email format and
// docs/ELIGIBILITY_RULES.md. No Markdown. No screenshot/OCR/source wording.
// No "no mutual contacts" wording. No vague counts.

export interface EmailDraftPerson {
  id: string;
  name: string;
  title?: string;
  headline?: string;
  location?: string;
  currentlyAtTargetCompany: boolean;
  approved: boolean;
  currentRoles: RoleEntry[];
  namedMutuals: string[];
  vagueMutualCount?: number;
}

export interface FormatEmailOptions {
  maxPeople?: number;
  maxMutuals?: number;
}

export const EMAIL_SIGNATURE = "Best,\nNilhan";

// Defensively enforce all rules even if the caller already filtered.
function selectEmailPeople(
  people: EmailDraftPerson[],
  maxPeople: number
): EmailDraftPerson[] {
  const filtered = people.filter(
    (p) => p.approved && p.currentlyAtTargetCompany && p.namedMutuals.length > 0
  );
  return filtered.slice(0, maxPeople);
}

function currentRoleLine(person: EmailDraftPerson, targetCompanyName: string): string | null {
  if (person.currentRoles.length === 0) return null;
  const targetRole =
    person.currentRoles.find((r) =>
      r.company.trim().toLowerCase() === targetCompanyName.trim().toLowerCase()
    ) ?? person.currentRoles[0];
  if (!targetRole) return null;
  return `Current: ${targetRole.title} at ${targetRole.company}`;
}

function titleLine(person: EmailDraftPerson): string | null {
  const t = person.title ?? person.headline;
  return t && t.trim().length > 0 ? t.trim() : null;
}

export function formatPersonBlock(
  person: EmailDraftPerson,
  index: number,
  targetCompanyName: string,
  maxMutuals: number
): string {
  const lines: string[] = [];
  lines.push(`${index}. ${person.name.trim()}`);

  const title = titleLine(person);
  if (title) lines.push(title);

  if (person.location && person.location.trim().length > 0) {
    lines.push(person.location.trim());
  }

  const current = currentRoleLine(person, targetCompanyName);
  if (current) lines.push(current);

  lines.push("");
  lines.push("Mutual Contacts:");
  lines.push("");

  const mutuals = person.namedMutuals.slice(0, maxMutuals);
  for (const m of mutuals) {
    lines.push(m.trim());
    lines.push("");
  }

  lines.push("---");
  return lines.join("\n");
}

export function formatEmailDraft(
  companyName: string,
  people: EmailDraftPerson[],
  options: FormatEmailOptions = {}
): string {
  const maxPeople = options.maxPeople ?? MAX_PEOPLE_PER_EMAIL;
  const maxMutuals = options.maxMutuals ?? MAX_NAMED_MUTUALS_PER_PERSON;

  const selected = selectEmailPeople(people, maxPeople);

  const blocks: string[] = [];
  blocks.push("Hi Paul,");
  blocks.push("");
  blocks.push(
    `I found some contacts at ${companyName.trim()} you might be able to reach.`
  );
  blocks.push("");

  if (selected.length === 0) {
    // No wording about "no contacts" or screenshots — just the signature.
    blocks.push(EMAIL_SIGNATURE);
    return blocks.join("\n");
  }

  selected.forEach((person, i) => {
    blocks.push(formatPersonBlock(person, i + 1, companyName, maxMutuals));
    blocks.push("");
  });

  blocks.push(EMAIL_SIGNATURE);
  return blocks.join("\n").trimEnd() + "\n";
}
