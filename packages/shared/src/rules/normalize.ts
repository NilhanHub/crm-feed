import type { RoleEntry } from "../types/entities.js";

// Deterministic string helpers. No randomness, no LLM judgement.

const COMPANY_SUFFIXES = [
  "ltd", "limited", "inc", "inc.", "llc", "corp", "corp.",
  "corporation", "co", "co.", "plc", "gmbh", "sa", "pvt", "pvt.",
  "pte", "pte.", "llp", "group", "holdings",
];

export function normalizeString(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

export function normalizeCompanyName(s: string): string {
  let n = normalizeString(s);
  n = n.replace(/[.,]/g, "");
  const words = n.split(" ").filter(Boolean);
  while (words.length > 1) {
    const last = words[words.length - 1] ?? "";
    if (COMPANY_SUFFIXES.includes(last)) {
      words.pop();
    } else {
      break;
    }
  }
  return words.join(" ").trim();
}

export function isCompanyMatch(a: string, b: string): boolean {
  return normalizeCompanyName(a) === normalizeCompanyName(b);
}

export function roleMatchesTargetCompany(
  role: RoleEntry,
  targetCompanyName: string
): boolean {
  return isCompanyMatch(role.company, targetCompanyName);
}

export function normalizePersonName(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

export function personDedupKey(name: string, targetCompanyName: string): string {
  return `${normalizePersonName(name)}::${normalizeCompanyName(targetCompanyName)}`;
}
