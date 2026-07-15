import { describe, it, expect } from "vitest";
import {
  evaluateEligibility,
  computeCurrentlyAtTarget,
  dedupePeople,
} from "../src/rules/eligibility.js";
import type { ExtractionPerson } from "../src/schema/extraction.js";

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

describe("eligibility: currently at target company", () => {
  it("includes a person with a current role at the target company + named mutual", () => {
    const p = makePerson({
      name: "Alice",
      personId: "a1",
      currentRoles: [{ title: "CTO", company: "Acme Corp" }],
      mutualContacts: { named: [{ name: "Bob" }], vagueCount: null },
    });
    const r = evaluateEligibility({ person: p, targetCompanyName: "Acme" });
    expect(r.eligible).toBe(true);
    expect(r.currentlyAtTargetCompany).toBe(true);
    expect(r.hasNamedMutual).toBe(true);
  });

  it("excludes a past-only person even with a named mutual", () => {
    const p = makePerson({
      name: "Bob",
      personId: "b1",
      currentRoles: [{ title: "Engineer", company: "Other Co" }],
      pastRoles: [{ title: "Engineer", company: "Acme Corp" }],
      mutualContacts: { named: [{ name: "Sue" }], vagueCount: null },
    });
    const r = evaluateEligibility({ person: p, targetCompanyName: "Acme" });
    expect(r.eligible).toBe(false);
    expect(r.reasons).toContain("past-only: no current role at target company");
  });

  it("matches company case-insensitively and ignores suffixes", () => {
    const p = makePerson({
      name: "Cas",
      personId: "c1",
      currentRoles: [{ title: "COO", company: "ACME CORP LTD" }],
      mutualContacts: { named: [{ name: "Sue" }], vagueCount: null },
    });
    expect(computeCurrentlyAtTarget(p, "acme")).toBe(true);
  });
});

describe("eligibility: named mutuals", () => {
  it("excludes a person currently at target but with no named mutuals", () => {
    const p = makePerson({
      name: "Dan",
      personId: "d1",
      currentRoles: [{ title: "CTO", company: "Acme" }],
      mutualContacts: { named: [], vagueCount: 3 },
    });
    const r = evaluateEligibility({ person: p, targetCompanyName: "Acme" });
    expect(r.eligible).toBe(false);
    expect(r.hasNamedMutual).toBe(false);
    expect(r.hasVagueOnly).toBe(true);
    expect(r.reasons.some((x) => x.includes("vague"))).toBe(true);
  });

  it("excludes a person with no mutuals at all", () => {
    const p = makePerson({
      name: "Eve",
      personId: "e1",
      currentRoles: [{ title: "CTO", company: "Acme" }],
      mutualContacts: { named: [], vagueCount: null },
    });
    const r = evaluateEligibility({ person: p, targetCompanyName: "Acme" });
    expect(r.eligible).toBe(false);
    expect(r.reasons).toContain("no named mutual contact");
  });
});

describe("eligibility: dedupe", () => {
  it("removes duplicates by normalised name + target, keeping higher confidence", () => {
    const p1 = makePerson({ name: "Alice Lee", personId: "a1", confidence: 0.6 });
    const p2 = makePerson({ name: "alice lee", personId: "a2", confidence: 0.9 });
    const { unique, duplicatesRemoved } = dedupePeople([p1, p2], "Acme");
    expect(unique.length).toBe(1);
    expect(unique[0]!.personId).toBe("a2");
    expect(duplicatesRemoved.length).toBe(1);
  });

  it("keeps people with different names", () => {
    const p1 = makePerson({ name: "Alice", personId: "a1" });
    const p2 = makePerson({ name: "Bob", personId: "b1" });
    const { unique } = dedupePeople([p1, p2], "Acme");
    expect(unique.length).toBe(2);
  });
});
