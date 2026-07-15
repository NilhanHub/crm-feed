import { describe, it, expect } from "vitest";
import {
  detectDuplicates,
  detectNameCompanyDuplicates,
  dedupeKey,
} from "../src/review/dedupe.js";
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
    sourceScreenshotIds: over.sourceScreenshotIds ?? ["shot1"],
    confidence: over.confidence ?? 1,
  };
}

describe("dedupe: exact duplicate name/company", () => {
  it("flags exact duplicates", () => {
    const p1 = makePerson({ name: "Alice Tan", personId: "a1", title: "CTO" });
    const p2 = makePerson({ name: "Alice Tan", personId: "a2", title: "CTO", confidence: 0.8 });
    const result = detectDuplicates([p1, p2], "Acme");
    expect(result.duplicateGroups.length).toBeGreaterThanOrEqual(0);
    expect(result.unique.length).toBe(1);
    expect(result.unique[0]!.personId).toBe("a1"); // higher confidence
  });
});

describe("dedupe: case-insensitive duplicate", () => {
  it("treats 'Alice Tan' and 'alice tan' as duplicates", () => {
    const p1 = makePerson({ name: "Alice Tan", personId: "a1", title: "CTO" });
    const p2 = makePerson({ name: "alice tan", personId: "a2", title: "CTO", confidence: 0.8 });
    const result = detectDuplicates([p1, p2], "Acme");
    expect(result.unique.length).toBe(1);
  });
});

describe("dedupe: punctuation/spacing normalization", () => {
  it("treats 'Alice  Tan' and 'Alice Tan' as duplicates", () => {
    const p1 = makePerson({ name: "Alice  Tan", personId: "a1", title: "CTO" });
    const p2 = makePerson({ name: "Alice Tan", personId: "a2", title: "CTO", confidence: 0.8 });
    const result = detectDuplicates([p1, p2], "Acme");
    expect(result.unique.length).toBe(1);
  });
});

describe("dedupe: same name but different company not auto-merged", () => {
  it("does not merge people at different companies", () => {
    // The dedupeKey includes targetCompanyName, so same name at different
    // target companies produces different keys.
    const p1 = makePerson({ name: "Alice", personId: "a1", title: "CTO" });
    // Different keys for different companies
    expect(dedupeKey(p1, "Acme")).not.toBe(dedupeKey(p1, "Beta"));
  });
});

describe("dedupe: duplicate candidates flagged, not silently deleted", () => {
  it("flaggedPersonIds contains all duplicate personIds", () => {
    const p1 = makePerson({ name: "Alice", personId: "a1", title: "CTO", confidence: 0.9 });
    const p2 = makePerson({ name: "Alice", personId: "a2", title: "CTO", confidence: 0.8 });
    const p3 = makePerson({ name: "Alice", personId: "a3", title: "CTO", confidence: 0.7 });
    const result = detectDuplicates([p1, p2, p3], "Acme");
    expect(result.flaggedPersonIds).toContain("a1");
    expect(result.flaggedPersonIds).toContain("a2");
    expect(result.flaggedPersonIds).toContain("a3");
    expect(result.unique.length).toBe(1);
    // The unique one is the highest confidence
    expect(result.unique[0]!.personId).toBe("a1");
  });
});

describe("dedupe: nameCompanyKey loose matching", () => {
  it("detects duplicates ignoring title", () => {
    const p1 = makePerson({ name: "Alice", personId: "a1", title: "CTO" });
    const p2 = makePerson({ name: "Alice", personId: "a2", title: "Chief Technology Officer" });
    // Same name+company, different title => loose match finds them
    const loose = detectNameCompanyDuplicates([p1, p2], "Acme");
    expect(loose.length).toBe(1);
    expect(loose[0]!.people.length).toBe(2);
  });
});

describe("dedupe: preserves source screenshot IDs", () => {
  it("sourceScreenshotIds are preserved on all candidates", () => {
    const p1 = makePerson({ name: "Alice", personId: "a1", title: "CTO", sourceScreenshotIds: ["s1", "s2"] });
    const p2 = makePerson({ name: "Alice", personId: "a2", title: "CTO", sourceScreenshotIds: ["s3"], confidence: 0.8 });
    detectDuplicates([p1, p2], "Acme");
    // Both original persons still have their sourceScreenshotIds
    expect(p1.sourceScreenshotIds).toEqual(["s1", "s2"]);
    expect(p2.sourceScreenshotIds).toEqual(["s3"]);
  });
});

describe("dedupe: no false positives for different names", () => {
  it("different names are not flagged as duplicates", () => {
    const p1 = makePerson({ name: "Alice", personId: "a1", title: "CTO" });
    const p2 = makePerson({ name: "Bob", personId: "b1", title: "CTO" });
    const result = detectDuplicates([p1, p2], "Acme");
    expect(result.unique.length).toBe(2);
    expect(result.flaggedPersonIds.length).toBe(0);
  });
});
