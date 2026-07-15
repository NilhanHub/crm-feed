import { describe, it, expect } from "vitest";
import {
  projectLatestReviewState,
  projectLatestReviewStates,
  isLatestApproved,
  approvedPersonIds,
  getReviewHistory,
} from "../src/review/projection.js";
import type { ReviewDecision } from "../src/types/entities.js";

function makeReview(over: Partial<ReviewDecision> & { id: string; extractedPersonId: string; decidedAt: string }): ReviewDecision {
  return {
    id: over.id,
    extractedPersonId: over.extractedPersonId,
    decision: over.decision ?? "approved",
    note: over.note,
    reviewedBy: over.reviewedBy ?? "Nilhan",
    decidedAt: over.decidedAt,
  };
}

describe("review projection: basic latest", () => {
  it("returns null for empty decisions", () => {
    expect(projectLatestReviewState([])).toBeNull();
  });

  it("returns the single decision as latest", () => {
    const d = makeReview({ id: "r1", extractedPersonId: "p1", decidedAt: "2026-01-01T10:00:00Z", decision: "approved" });
    const state = projectLatestReviewState([d]);
    expect(state?.latestDecision).toBe("approved");
    expect(state?.historyCount).toBe(1);
  });
});

describe("review projection: approve then reject => excluded", () => {
  it("latest rejection wins over earlier approval", () => {
    const approve = makeReview({ id: "r1", extractedPersonId: "p1", decidedAt: "2026-01-01T10:00:00Z", decision: "approved", note: "looks good" });
    const reject = makeReview({ id: "r2", extractedPersonId: "p1", decidedAt: "2026-01-01T11:00:00Z", decision: "rejected", note: "actually no" });
    const state = projectLatestReviewState([approve, reject]);
    expect(state?.latestDecision).toBe("rejected");
    expect(state?.latestNote).toBe("actually no");
    expect(isLatestApproved(state)).toBe(false);
  });
});

describe("review projection: reject then approve => included", () => {
  it("latest approval wins over earlier rejection", () => {
    const reject = makeReview({ id: "r1", extractedPersonId: "p1", decidedAt: "2026-01-01T10:00:00Z", decision: "rejected" });
    const approve = makeReview({ id: "r2", extractedPersonId: "p1", decidedAt: "2026-01-01T11:00:00Z", decision: "approved" });
    const state = projectLatestReviewState([reject, approve]);
    expect(state?.latestDecision).toBe("approved");
    expect(isLatestApproved(state)).toBe(true);
  });
});

describe("review projection: older approval ignored when newer rejection exists", () => {
  it("three decisions: approve, reject, approve => latest approve wins", () => {
    const d1 = makeReview({ id: "r1", extractedPersonId: "p1", decidedAt: "2026-01-01T10:00:00Z", decision: "approved" });
    const d2 = makeReview({ id: "r2", extractedPersonId: "p1", decidedAt: "2026-01-01T11:00:00Z", decision: "rejected" });
    const d3 = makeReview({ id: "r3", extractedPersonId: "p1", decidedAt: "2026-01-01T12:00:00Z", decision: "approved" });
    const state = projectLatestReviewState([d1, d2, d3]);
    expect(state?.latestDecision).toBe("approved");
    expect(state?.historyCount).toBe(3);
  });
});

describe("review projection: latest reviewer note retained", () => {
  it("keeps the note from the latest decision only", () => {
    const d1 = makeReview({ id: "r1", extractedPersonId: "p1", decidedAt: "2026-01-01T10:00:00Z", decision: "approved", note: "first note" });
    const d2 = makeReview({ id: "r2", extractedPersonId: "p1", decidedAt: "2026-01-01T11:00:00Z", decision: "rejected", note: "second note" });
    const state = projectLatestReviewState([d1, d2]);
    expect(state?.latestNote).toBe("second note");
  });
});

describe("review projection: deterministic sorting when timestamps tie", () => {
  it("equal timestamps: last in input array wins (stable sort)", () => {
    const d1 = makeReview({ id: "r1", extractedPersonId: "p1", decidedAt: "2026-01-01T10:00:00Z", decision: "approved" });
    const d2 = makeReview({ id: "r2", extractedPersonId: "p1", decidedAt: "2026-01-01T10:00:00Z", decision: "rejected" });
    // d2 is last in array, so it should be "latest" after stable sort
    const state = projectLatestReviewState([d1, d2]);
    expect(state?.latestDecision).toBe("rejected");
    expect(state?.latestReviewId).toBe("r2");
  });
});

describe("review projection: batch projection map", () => {
  it("builds a map of personId -> CurrentReviewState", () => {
    const d1 = makeReview({ id: "r1", extractedPersonId: "p1", decidedAt: "2026-01-01T10:00:00Z", decision: "approved" });
    const d2 = makeReview({ id: "r2", extractedPersonId: "p2", decidedAt: "2026-01-01T10:00:00Z", decision: "rejected" });
    const d3 = makeReview({ id: "r3", extractedPersonId: "p1", decidedAt: "2026-01-01T11:00:00Z", decision: "rejected" });
    const map = projectLatestReviewStates([d1, d2, d3]);
    expect(map.get("p1")?.latestDecision).toBe("rejected");
    expect(map.get("p2")?.latestDecision).toBe("rejected");
    expect(approvedPersonIds(map).has("p1")).toBe(false);
    expect(approvedPersonIds(map).has("p2")).toBe(false);
  });
});

describe("review projection: history", () => {
  it("returns decisions sorted by decidedAt ascending", () => {
    const d1 = makeReview({ id: "r1", extractedPersonId: "p1", decidedAt: "2026-01-01T12:00:00Z", decision: "approved" });
    const d2 = makeReview({ id: "r2", extractedPersonId: "p1", decidedAt: "2026-01-01T10:00:00Z", decision: "rejected" });
    const d3 = makeReview({ id: "r3", extractedPersonId: "p2", decidedAt: "2026-01-01T11:00:00Z", decision: "approved" });
    const hist = getReviewHistory([d1, d2, d3], "p1");
    expect(hist.decisions.length).toBe(2);
    expect(hist.decisions[0]!.id).toBe("r2"); // earliest first
    expect(hist.decisions[1]!.id).toBe("r1");
  });
});

describe("review projection: needs_review status", () => {
  it("needs_review is not approved", () => {
    const d = makeReview({ id: "r1", extractedPersonId: "p1", decidedAt: "2026-01-01T10:00:00Z", decision: "needs_review" });
    const state = projectLatestReviewState([d]);
    expect(state?.latestDecision).toBe("needs_review");
    expect(isLatestApproved(state)).toBe(false);
  });
});
