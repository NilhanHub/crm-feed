import { describe, it, expect } from "vitest";
import {
  safeParseExtractionPayload,
  safeParseGeminiExtraction,
} from "../src/schema/extraction.js";

function validPayload(): unknown {
  return {
    targetCompanyName: "Acme Corp",
    screenshots: [{ screenshotId: "shot_1" }],
    people: [
      {
        personId: "alice",
        name: "Alice Tan",
        title: "CTO",
        location: "London",
        currentRoles: [{ title: "CTO", company: "Acme Corp", evidenceText: "CTO at Acme Corp" }],
        pastRoles: [],
        mutualContacts: { named: [{ name: "Sue Lee" }], vagueCount: null },
        sourceScreenshotIds: ["shot_1"],
        confidence: 0.9,
        fieldConfidence: { name: 0.95, title: 0.85 },
      },
    ],
    extractionMeta: {
      provider: "gemini",
      overallConfidence: 0.9,
      extractionWarnings: [],
    },
  };
}

describe("schema validation: valid Gemini output", () => {
  it("accepts a valid payload", () => {
    const result = safeParseExtractionPayload(validPayload());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.people[0]!.name).toBe("Alice Tan");
      expect(result.data.people[0]!.currentRoles[0]!.evidenceText).toBe("CTO at Acme Corp");
      expect(result.data.people[0]!.fieldConfidence?.name).toBe(0.95);
    }
  });

  it("accepts a valid Gemini-specific payload", () => {
    const result = safeParseGeminiExtraction(validPayload());
    expect(result.ok).toBe(true);
  });
});

describe("schema validation: missing person name", () => {
  it("rejects a person without a name", () => {
    const p = validPayload() as Record<string, unknown>;
    const people = p.people as Record<string, unknown>[];
    people[0]!.name = "";
    const result = safeParseExtractionPayload(p);
    expect(result.ok).toBe(false);
  });
});

describe("schema validation: invalid mutual contacts", () => {
  it("rejects named mutuals that are strings instead of objects", () => {
    const p = validPayload() as Record<string, unknown>;
    const people = p.people as Record<string, unknown>[];
    (people[0]!.mutualContacts as Record<string, unknown>).named = ["Sue Lee"];
    const result = safeParseExtractionPayload(p);
    expect(result.ok).toBe(false);
  });
});

describe("schema validation: vague mutual count present but named mutuals empty", () => {
  it("accepts vague count with empty named mutuals (valid — person will be ineligible)", () => {
    const p = validPayload() as Record<string, unknown>;
    const people = p.people as Record<string, unknown>[];
    (people[0]!.mutualContacts as Record<string, unknown>).named = [];
    (people[0]!.mutualContacts as Record<string, unknown>).vagueCount = 3;
    const result = safeParseExtractionPayload(p);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.people[0]!.mutualContacts.named).toHaveLength(0);
      expect(result.data.people[0]!.mutualContacts.vagueCount).toBe(3);
    }
  });
});

describe("schema validation: current role missing", () => {
  it("accepts a person with no current roles (past-only — will be ineligible)", () => {
    const p = validPayload() as Record<string, unknown>;
    const people = p.people as Record<string, unknown>[];
    people[0]!.currentRoles = [];
    people[0]!.pastRoles = [{ title: "Engineer", company: "Acme Corp" }];
    const result = safeParseExtractionPayload(p);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.people[0]!.currentRoles).toHaveLength(0);
    }
  });
});

describe("schema validation: past-only person", () => {
  it("accepts a past-only person (schema valid, will be ineligible by rules)", () => {
    const p = validPayload() as Record<string, unknown>;
    const people = p.people as Record<string, unknown>[];
    people[0]!.currentRoles = [{ title: "Engineer", company: "Other Co" }];
    people[0]!.pastRoles = [{ title: "Engineer", company: "Acme Corp" }];
    const result = safeParseExtractionPayload(p);
    expect(result.ok).toBe(true);
  });
});

describe("schema validation: confidence missing", () => {
  it("defaults confidence to 1.0 when not provided", () => {
    const p = validPayload() as Record<string, unknown>;
    const people = p.people as Record<string, unknown>[];
    delete people[0]!.confidence;
    const result = safeParseExtractionPayload(p);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.people[0]!.confidence).toBe(1);
    }
  });
});

describe("schema validation: invalid screenshot ID", () => {
  it("rejects empty screenshot ID in screenshot ref", () => {
    const p = validPayload() as Record<string, unknown>;
    (p.screenshots as Record<string, unknown>[])[0]!.screenshotId = "";
    const result = safeParseExtractionPayload(p);
    expect(result.ok).toBe(false);
  });
});

describe("schema validation: Gemini-specific provider check", () => {
  it("rejects non-gemini provider in Gemini-specific schema", () => {
    const p = validPayload() as Record<string, unknown>;
    (p.extractionMeta as Record<string, unknown>).provider = "manual_attach";
    const result = safeParseGeminiExtraction(p);
    expect(result.ok).toBe(false);
  });
});

describe("schema validation: extraction warnings", () => {
  it("accepts extraction warnings", () => {
    const p = validPayload() as Record<string, unknown>;
    (p.extractionMeta as Record<string, unknown>).extractionWarnings = ["low light", "text partially obscured"];
    const result = safeParseExtractionPayload(p);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.extractionMeta.extractionWarnings).toHaveLength(2);
    }
  });
});
