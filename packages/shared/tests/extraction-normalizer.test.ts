import { describe, it, expect } from "vitest";
import { normalizeGeminiExtraction, normalizePerson } from "../src/extraction/normalizer.js";
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
    fieldConfidence: over.fieldConfidence ?? null,
  };
}

describe("normalization: normal person with current role", () => {
  it("normalizes a person with current role at target", () => {
    const person = makePerson({
      name: "Alice Tan", personId: "alice",
      title: "CTO", location: "London",
      currentRoles: [{ title: "CTO", company: "Acme Corp", evidenceText: "CTO at Acme Corp" }],
      mutualContacts: { named: [{ name: "Sue Lee" }], vagueCount: null },
      sourceScreenshotIds: ["shot_1"],
      confidence: 0.9,
    });
    const normalized = normalizePerson(person, "gemini");
    expect(normalized.name).toBe("Alice Tan");
    expect(normalized.currentRoles[0]!.evidenceText).toBe("CTO at Acme Corp");
    expect(normalized.provenance).toBe("gemini");
    expect(normalized.confidenceClass).toBe("high");
  });
});

describe("normalization: past-only person preserved but later ineligible", () => {
  it("preserves past-only person with past roles", () => {
    const person = makePerson({
      name: "Bob", personId: "bob",
      currentRoles: [{ title: "Engineer", company: "Other Co" }],
      pastRoles: [{ title: "Engineer", company: "Acme Corp", evidenceText: "Engineer at Acme Corp (2018-2020)" }],
      mutualContacts: { named: [{ name: "Kit" }], vagueCount: null },
      confidence: 0.8,
    });
    const normalized = normalizePerson(person, "gemini");
    expect(normalized.pastRoles).toHaveLength(1);
    expect(normalized.pastRoles[0]!.evidenceText).toBe("Engineer at Acme Corp (2018-2020)");
    // The normalizer preserves; eligibility rules will exclude later
  });
});

describe("normalization: named mutual contacts preserved", () => {
  it("preserves named mutual contacts", () => {
    const person = makePerson({
      name: "Alice", personId: "alice",
      currentRoles: [{ title: "CTO", company: "Acme" }],
      mutualContacts: { named: [{ name: "Sue Lee", headline: "PM at Tech" }, { name: "Tom Ng" }], vagueCount: null },
      confidence: 1,
    });
    const normalized = normalizePerson(person, "gemini");
    expect(normalized.mutualContacts.named).toHaveLength(2);
    expect(normalized.mutualContacts.named[0]!.name).toBe("Sue Lee");
    expect(normalized.mutualContacts.named[0]!.headline).toBe("PM at Tech");
  });
});

describe("normalization: vague mutual counts preserved but excluded from email/export", () => {
  it("preserves vague count in normalized output", () => {
    const person = makePerson({
      name: "Alice", personId: "alice",
      currentRoles: [{ title: "CTO", company: "Acme" }],
      mutualContacts: { named: [{ name: "Sue" }], vagueCount: 5 },
      confidence: 1,
    });
    const normalized = normalizePerson(person, "gemini");
    expect(normalized.mutualContacts.vagueCount).toBe(5);
    // Named mutuals still present
    expect(normalized.mutualContacts.named).toHaveLength(1);
  });
});

describe("normalization: low-confidence field flagged", () => {
  it("flags low-confidence fields", () => {
    const person = makePerson({
      name: "Alice", personId: "alice",
      currentRoles: [{ title: "CTO", company: "Acme" }],
      mutualContacts: { named: [{ name: "Sue" }], vagueCount: null },
      confidence: 0.3,
      fieldConfidence: { name: 0.9, title: 0.2, location: 0.4 },
    });
    const normalized = normalizePerson(person, "gemini");
    expect(normalized.confidenceClass).toBe("low");
    expect(normalized.hasLowConfidenceField).toBe(true);
    expect(normalized.fieldConfidence?.title).toBe("low");
    expect(normalized.fieldConfidence?.location).toBe("low");
    expect(normalized.fieldConfidence?.name).toBe("high");
  });
});

describe("normalization: screenshot provenance preserved", () => {
  it("preserves source screenshot IDs", () => {
    const person = makePerson({
      name: "Alice", personId: "alice",
      currentRoles: [{ title: "CTO", company: "Acme" }],
      mutualContacts: { named: [{ name: "Sue" }], vagueCount: null },
      sourceScreenshotIds: ["shot_1", "shot_2"],
      confidence: 1,
    });
    const normalized = normalizePerson(person, "gemini");
    expect(normalized.sourceScreenshotIds).toEqual(["shot_1", "shot_2"]);
  });
});

describe("normalization: full payload normalization", () => {
  it("normalizes a full extraction payload", () => {
    const payload = {
      targetCompanyName: "Acme Corp",
      screenshots: [{ screenshotId: "shot_1" }],
      people: [
        makePerson({ name: "Alice", personId: "alice", confidence: 0.9 }),
        makePerson({ name: "Bob", personId: "bob", confidence: 0.4 }),
      ],
      extractionMeta: {
        provider: "gemini" as const,
        overallConfidence: 0.7,
        extractionWarnings: ["low light"],
      },
      sourceExtractionRunId: "run_123",
    };
    const normalized = normalizeGeminiExtraction(payload, "run_123");
    expect(normalized.targetCompanyName).toBe("Acme Corp");
    expect(normalized.people).toHaveLength(2);
    expect(normalized.people[0]!.confidenceClass).toBe("high");
    expect(normalized.people[1]!.confidenceClass).toBe("low");
    expect(normalized.extractionWarnings).toEqual(["low light"]);
    expect(normalized.sourceExtractionRunId).toBe("run_123");
    expect(normalized.provider).toBe("gemini");
  });
});

describe("normalization: never invents missing fields", () => {
  it("does not invent headline/title/location when null", () => {
    const person = makePerson({
      name: "Alice", personId: "alice",
      currentRoles: [{ title: "CTO", company: "Acme" }],
      mutualContacts: { named: [{ name: "Sue" }], vagueCount: null },
      headline: null, title: null, location: null,
      confidence: 1,
    });
    const normalized = normalizePerson(person, "gemini");
    expect(normalized.headline).toBeNull();
    expect(normalized.title).toBeNull();
    expect(normalized.location).toBeNull();
  });
});
