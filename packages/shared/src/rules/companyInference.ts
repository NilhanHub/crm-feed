import { isCompanyMatch } from "./normalize.js";

/**
 * A company candidate extracted from a screenshot with its signal type.
 */
export interface CompanyCandidate {
  name: string;
  normalizedName: string;
  signalType: "current_role" | "past_role" | "profile_mention" | "ad_sidebar" | "search_hint" | "other";
  mentionCount: number;
  evidenceText?: string;
}

/**
 * Result of deterministic company inference for a single screenshot.
 */
export interface CompanyInferenceResult {
  /** The dominant/normalized company name if confidence is high enough. */
  dominantCompanyName: string | null;
  /** The dominant normalized name for matching. */
  dominantNormalized: string | null;
  /** Confidence level: 0-1. */
  confidence: number;
  /** All candidates found. */
  candidates: CompanyCandidate[];
  /** Whether this screenshot needs human review for company assignment. */
  needsReview: boolean;
  /** Short human-readable reasoning. */
  reasoning: string;
}

/**
 * Deterministic company inference from a set of company candidates.
 *
 * Rules:
 * - Current-role mentions are weighted higher than past-role or noise mentions.
 * - Ad/sidebar/promoted names are downweighted.
 * - If one normalized company clearly dominates current-company mentions,
 *   it is selected with high confidence.
 * - If confidence is low or mixed, the result is marked needsReview=true.
 * - If no current-company mentions exist, the result is needsReview=true.
 */
export function inferCompany(candidates: CompanyCandidate[]): CompanyInferenceResult {
  if (candidates.length === 0) {
    return {
      dominantCompanyName: null,
      dominantNormalized: null,
      confidence: 0,
      candidates: [],
      needsReview: true,
      reasoning: "No company candidates found in screenshot",
    };
  }

  // Group by normalized name and count mentions by signal type
  const byNormalized = new Map<string, {
    names: string[];
    currentMentions: number;
    pastMentions: number;
    profileMentions: number;
    adMentions: number;
    otherMentions: number;
    totalMentions: number;
  }>();

  for (const c of candidates) {
    const norm = c.normalizedName;
    let entry = byNormalized.get(norm);
    if (!entry) {
      entry = { names: [], currentMentions: 0, pastMentions: 0, profileMentions: 0, adMentions: 0, otherMentions: 0, totalMentions: 0 };
      byNormalized.set(norm, entry);
    }
    entry.names.push(c.name);
    entry.totalMentions += c.mentionCount;
    switch (c.signalType) {
      case "current_role": entry.currentMentions += c.mentionCount; break;
      case "past_role": entry.pastMentions += c.mentionCount; break;
      case "profile_mention": entry.profileMentions += c.mentionCount; break;
      case "ad_sidebar": entry.adMentions += c.mentionCount; break;
      default: entry.otherMentions += c.mentionCount; break;
    }
  }

  // Weighted score: current=3, profile_mention=2, past=1, ad=0.5, other=0.5
  const scored: { norm: string; names: string[]; score: number; currentMentions: number; totalMentions: number }[] = [];
  let totalCurrentMentions = 0;
  for (const [norm, entry] of byNormalized) {
    const score = entry.currentMentions * 3 + entry.profileMentions * 2 + entry.pastMentions * 1 + entry.adMentions * 0.5 + entry.otherMentions * 0.5;
    scored.push({ norm, names: entry.names, score, currentMentions: entry.currentMentions, totalMentions: entry.totalMentions });
    totalCurrentMentions += entry.currentMentions;
  }

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  const top = scored[0]!;
  const runnerUp = scored[1];
  const hasMultipleStrong = runnerUp && runnerUp.score >= top.score * 0.5;
  const topCurrentPortion = totalCurrentMentions > 0 ? top.currentMentions / totalCurrentMentions : 0;

  // Decision logic
  if (top.currentMentions >= 2 && topCurrentPortion >= 0.6 && !hasMultipleStrong) {
    return {
      dominantCompanyName: top.names[0]!,
      dominantNormalized: top.norm,
      confidence: Math.min(1, 0.5 + top.currentMentions * 0.1 + topCurrentPortion * 0.2),
      candidates,
      needsReview: false,
      reasoning: `Dominant company "${top.names[0]!}" has ${top.currentMentions} current-role mention(s) (${Math.round(topCurrentPortion * 100)}% of current-role mentions)`,
    };
  }

  if (top.currentMentions > 0 && !hasMultipleStrong) {
    // Some current mentions but below threshold
    return {
      dominantCompanyName: top.names[0]!,
      dominantNormalized: top.norm,
      confidence: 0.3 + top.currentMentions * 0.1,
      candidates,
      needsReview: true,
      reasoning: `Low confidence: "${top.names[0]!}" has only ${top.currentMentions} current-role mention(s)`,
    };
  }

  if (hasMultipleStrong) {
    return {
      dominantCompanyName: top.names[0]!,
      dominantNormalized: top.norm,
      confidence: 0.3,
      candidates,
      needsReview: true,
      reasoning: `Mixed: "${top.names[0]!}" and "${runnerUp!.names[0]!}" both have strong signals`,
    };
  }

  // No current mentions at all
  return {
    dominantCompanyName: top.names[0]!,
    dominantNormalized: top.norm,
    confidence: 0.2,
    candidates,
    needsReview: true,
    reasoning: `No current-role company mentions found; best guess "${top.names[0]!}" from past/noise signals`,
  };
}

/**
 * Find an existing company by normalized name match, or return null.
 */
export function findMatchingCompany(
  companies: { id: string; name: string; aliases?: string[] }[],
  normalizedName: string
): { id: string; name: string } | null {
  for (const c of companies) {
    if (isCompanyMatch(c.name, normalizedName)) return { id: c.id, name: c.name };
    if (c.aliases) {
      for (const alias of c.aliases) {
        if (isCompanyMatch(alias, normalizedName)) return { id: c.id, name: c.name };
      }
    }
  }
  return null;
}
