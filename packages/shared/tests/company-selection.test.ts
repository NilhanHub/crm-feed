import { describe, it, expect } from "vitest";
import {
  selectCompanyScopedPeople,
  countExportReady,
  type SelectionInput,
} from "../src/review/selection.js";
import { projectLatestReviewStates } from "../src/review/projection.js";
import type { ExtractionPerson } from "../src/schema/extraction.js";
import type { ReviewDecision } from "../src/types/entities.js";

function makePerson(over: Partial<ExtractionPerson> & { name: string; personId: string }): ExtractionPerson {
  return {
    name: over.name,
    personId: over.personId,
    headline: over.headline ?? null,
    title: over.title ?? null,
    location: over.location ?? null,
    connectionDegree: over.connectionDegree ?? "unknown",
    currentRoles: over.currentRoles ?? [],
    pastRoles: over.pastRoles ?? [],
    mutualContacts: over.mutualContacts ?? { named: [], vagueCount: null },
    sourceScreenshotIds: over.sourceScreenshotIds ?? [],
    confidence: over.confidence ?? 1,
  };
}

function makeReview(personId: string, decision: "approved" | "rejected" | "needs_review", at: string): ReviewDecision {
  return { id: `r_${personId}_${at}`, extractedPersonId: personId, decision, reviewedBy: "Nilhan", decidedAt: at };
}

function makeInput(people: ExtractionPerson[], reviews: ReviewDecision[], companyName: string, companyId: string): SelectionInput {
  const states = projectLatestReviewStates(reviews);
  return { people, targetCompanyName: companyName, companyId, reviewStates: states };
}

describe("company-scoped selection: selected company only", () => {
  it("does not include people from other companies (company scoping is enforced by caller filtering)", () => {
    // The caller filters by companyId before calling. We test that the selection
    // itself only includes people currently at the target company name.
    const alice = makePerson({
      name: "Alice", personId: "p1",
      currentRoles: [{ title: "CTO", company: "Acme Corp" }],
      mutualContacts: { named: [{ name: "Sue" }], vagueCount: null },
    });
    const bob = makePerson({
      name: "Bob", personId: "p2",
      currentRoles: [{ title: "Engineer", company: "Other Co" }],
      mutualContacts: { named: [{ name: "Kit" }], vagueCount: null },
    });
    const reviews = [
      makeReview("p1", "approved", "2026-01-01T10:00:00Z"),
      makeReview("p2", "approved", "2026-01-01T10:00:00Z"),
    ];
    const selected = selectCompanyScopedPeople(makeInput([alice, bob], reviews, "Acme Corp", "co1"));
    const ids = selected.map((s) => s.person.personId);
    expect(ids).toContain("p1");
    expect(ids).not.toContain("p2"); // Bob is at "Other Co", not at target
  });
});

describe("company-scoped selection: approved only", () => {
  it("excludes rejected people", () => {
    const alice = makePerson({
      name: "Alice", personId: "p1",
      currentRoles: [{ title: "CTO", company: "Acme" }],
      mutualContacts: { named: [{ name: "Sue" }], vagueCount: null },
    });
    const bob = makePerson({
      name: "Bob", personId: "p2",
      currentRoles: [{ title: "COO", company: "Acme" }],
      mutualContacts: { named: [{ name: "Kit" }], vagueCount: null },
    });
    const reviews = [
      makeReview("p1", "approved", "2026-01-01T10:00:00Z"),
      makeReview("p2", "rejected", "2026-01-01T10:00:00Z"),
    ];
    const selected = selectCompanyScopedPeople(makeInput([alice, bob], reviews, "Acme", "co1"));
    expect(selected.map((s) => s.person.personId)).toEqual(["p1"]);
  });
});

describe("company-scoped selection: past-only excluded", () => {
  it("excludes people not currently at target", () => {
    const past = makePerson({
      name: "Past", personId: "p1",
      currentRoles: [{ title: "Eng", company: "Other" }],
      pastRoles: [{ title: "Eng", company: "Acme" }],
      mutualContacts: { named: [{ name: "Sue" }], vagueCount: null },
    });
    const reviews = [makeReview("p1", "approved", "2026-01-01T10:00:00Z")];
    const selected = selectCompanyScopedPeople(makeInput([past], reviews, "Acme", "co1"));
    expect(selected).toHaveLength(0);
  });
});

describe("company-scoped selection: no mutuals excluded", () => {
  it("excludes people with no named mutuals", () => {
    const nomut = makePerson({
      name: "NoMut", personId: "p1",
      currentRoles: [{ title: "CTO", company: "Acme" }],
      mutualContacts: { named: [], vagueCount: null },
    });
    const reviews = [makeReview("p1", "approved", "2026-01-01T10:00:00Z")];
    const selected = selectCompanyScopedPeople(makeInput([nomut], reviews, "Acme", "co1"));
    expect(selected).toHaveLength(0);
  });
});

describe("company-scoped selection: vague mutual count excluded", () => {
  it("excludes people with only vague count", () => {
    const vague = makePerson({
      name: "Vague", personId: "p1",
      currentRoles: [{ title: "CTO", company: "Acme" }],
      mutualContacts: { named: [], vagueCount: 5 },
    });
    const reviews = [makeReview("p1", "approved", "2026-01-01T10:00:00Z")];
    const selected = selectCompanyScopedPeople(makeInput([vague], reviews, "Acme", "co1"));
    expect(selected).toHaveLength(0);
  });
});

describe("company-scoped selection: max 7 named mutuals", () => {
  it("caps named mutuals to 7", () => {
    const person = makePerson({
      name: "Many", personId: "p1",
      currentRoles: [{ title: "CTO", company: "Acme" }],
      mutualContacts: {
        named: Array.from({ length: 10 }, (_, i) => ({ name: `M${i + 1}` })),
        vagueCount: null,
      },
    });
    const reviews = [makeReview("p1", "approved", "2026-01-01T10:00:00Z")];
    const selected = selectCompanyScopedPeople(makeInput([person], reviews, "Acme", "co1"));
    expect(selected).toHaveLength(1);
    expect(selected[0]!.namedMutuals).toHaveLength(7);
  });
});

describe("company-scoped selection: max 10 people", () => {
  it("caps to 10 people", () => {
    const people = Array.from({ length: 15 }, (_, i) =>
      makePerson({
        name: `Person ${i + 1}`, personId: `p${i + 1}`,
        currentRoles: [{ title: "Procurement", company: "Acme" }],
        mutualContacts: { named: [{ name: "Sue" }], vagueCount: null },
      })
    );
    const reviews = people.map((p) => makeReview(p.personId, "approved", "2026-01-01T10:00:00Z"));
    const selected = selectCompanyScopedPeople(makeInput(people, reviews, "Acme", "co1"));
    expect(selected).toHaveLength(10);
  });
});

describe("company-scoped selection: latest review state", () => {
  it("approve then reject => excluded", () => {
    const alice = makePerson({
      name: "Alice", personId: "p1",
      currentRoles: [{ title: "CTO", company: "Acme" }],
      mutualContacts: { named: [{ name: "Sue" }], vagueCount: null },
    });
    const reviews = [
      makeReview("p1", "approved", "2026-01-01T10:00:00Z"),
      makeReview("p1", "rejected", "2026-01-01T11:00:00Z"),
    ];
    const selected = selectCompanyScopedPeople(makeInput([alice], reviews, "Acme", "co1"));
    expect(selected).toHaveLength(0);
  });
});

describe("company-scoped selection: countExportReady", () => {
  it("counts eligible approved before capping", () => {
    const people = Array.from({ length: 15 }, (_, i) =>
      makePerson({
        name: `Person ${i + 1}`, personId: `p${i + 1}`,
        currentRoles: [{ title: "CTO", company: "Acme" }],
        mutualContacts: { named: [{ name: "Sue" }], vagueCount: null },
      })
    );
    const reviews = people.map((p) => makeReview(p.personId, "approved", "2026-01-01T10:00:00Z"));
    const count = countExportReady(makeInput(people, reviews, "Acme", "co1"));
    expect(count).toBe(15); // all 15 are export-ready, even though only 10 are selected
  });
});
