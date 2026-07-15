import type {
  ReviewDecision,
  CurrentReviewState,
  ReviewDecisionHistory,
} from "../types/entities.js";

// Deterministic latest-review projection.
// Given multiple review decisions for the same extracted person, only the
// latest decision is authoritative. Ties in decidedAt are broken by
// record order (last-written wins, which is the order in the input array).
// This is reusable by API, email formatter, and export logic.

export function projectLatestReviewState(
  decisions: ReviewDecision[]
): CurrentReviewState | null {
  if (decisions.length === 0) return null;

  const sorted = [...decisions].sort((a, b) => {
    // Sort by decidedAt ascending; for equal timestamps, preserve input order
    // (stable sort in modern JS engines keeps relative order for equal keys).
    const ta = a.decidedAt;
    const tb = b.decidedAt;
    if (ta < tb) return -1;
    if (ta > tb) return 1;
    return 0;
  });

  const latest = sorted[sorted.length - 1]!;

  return {
    extractedPersonId: latest.extractedPersonId,
    latestDecision: latest.decision,
    latestNote: latest.note,
    latestReviewedBy: latest.reviewedBy,
    latestDecidedAt: latest.decidedAt,
    latestReviewId: latest.id,
    historyCount: decisions.length,
  };
}

// Build a map of extractedPersonId -> CurrentReviewState from all decisions.
export function projectLatestReviewStates(
  allDecisions: ReviewDecision[]
): Map<string, CurrentReviewState> {
  const byPerson = new Map<string, ReviewDecision[]>();
  for (const d of allDecisions) {
    const arr = byPerson.get(d.extractedPersonId) ?? [];
    arr.push(d);
    byPerson.set(d.extractedPersonId, arr);
  }

  const result = new Map<string, CurrentReviewState>();
  for (const [personId, decisions] of byPerson) {
    const state = projectLatestReviewState(decisions);
    if (state) result.set(personId, state);
  }
  return result;
}

// Helper: is this person currently approved (latest decision is approved)?
export function isLatestApproved(state: CurrentReviewState | null | undefined): boolean {
  return state != null && state.latestDecision === "approved";
}

// Helper: get the set of approved person IDs from a projection map.
export function approvedPersonIds(
  states: Map<string, CurrentReviewState>
): Set<string> {
  const result = new Set<string>();
  for (const [personId, state] of states) {
    if (state.latestDecision === "approved") result.add(personId);
  }
  return result;
}

// Get review history for a person (sorted by decidedAt ascending).
export function getReviewHistory(
  allDecisions: ReviewDecision[],
  extractedPersonId: string
): ReviewDecisionHistory {
  const decisions = allDecisions
    .filter((d) => d.extractedPersonId === extractedPersonId)
    .sort((a, b) => {
      const ta = a.decidedAt;
      const tb = b.decidedAt;
      if (ta < tb) return -1;
      if (ta > tb) return 1;
      return 0;
    });
  return { extractedPersonId, decisions };
}
