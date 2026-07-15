import { describe, it, expect } from "vitest";
import { inferCompany, findMatchingCompany } from "../src/rules/companyInference.js";
import { normalizeCompanyName } from "../src/rules/normalize.js";
import type { CompanyCandidate } from "../src/rules/companyInference.js";

function cand(name: string, signalType: CompanyCandidate["signalType"], mentionCount = 1): CompanyCandidate {
  return { name, normalizedName: normalizeCompanyName(name), signalType, mentionCount };
}

describe("inferCompany", () => {
  it("returns needsReview for empty candidates", () => {
    const r = inferCompany([]);
    expect(r.needsReview).toBe(true);
    expect(r.dominantCompanyName).toBeNull();
    expect(r.confidence).toBe(0);
  });

  it("returns high confidence for dominant current-role mentions", () => {
    const r = inferCompany([
      cand("Acme Corp", "current_role", 3),
      cand("Other Inc", "current_role", 1),
    ]);
    expect(r.needsReview).toBe(false);
    expect(r.dominantCompanyName).toBe("Acme Corp");
    expect(r.confidence).toBeGreaterThan(0.5);
  });

  it("returns needsReview when current mentions below threshold", () => {
    const r = inferCompany([
      cand("Acme Corp", "current_role", 1),
    ]);
    expect(r.needsReview).toBe(true);
    expect(r.dominantCompanyName).toBe("Acme Corp");
  });

  it("returns needsReview when strong runner-up exists", () => {
    const r = inferCompany([
      cand("Acme Corp", "current_role", 2),
      cand("Other Inc", "current_role", 2),
    ]);
    expect(r.needsReview).toBe(true);
    expect(r.reasoning).toContain("Mixed");
  });

  it("returns needsReview when no current mentions exist", () => {
    const r = inferCompany([
      cand("Past Co", "past_role", 3),
      cand("Another Past", "past_role", 1),
    ]);
    expect(r.needsReview).toBe(true);
    expect(r.reasoning).toContain("No current-role");
  });

  it("uses weighted scoring: current_role picks dominant even with more past mentions", () => {
    const r = inferCompany([
      cand("Acme Corp", "current_role", 3),
      cand("Past Co", "past_role", 5),
    ]);
    expect(r.dominantCompanyName).toBe("Acme Corp");
    expect(r.dominantNormalized).toBe("acme");
  });

  it("recognizes profile_mention at medium weight", () => {
    const r = inferCompany([
      cand("Acme Corp", "profile_mention", 3),
      cand("Other Inc", "current_role", 1),
    ]);
    expect(r.dominantCompanyName).toBe("Acme Corp");
    expect(r.needsReview).toBe(true);
  });

  it("downweights ad_sidebar mentions when current role clearly dominates", () => {
    const r = inferCompany([
      cand("Acme Corp", "current_role", 4),
      cand("Ad Co", "ad_sidebar", 10),
    ]);
    expect(r.needsReview).toBe(false);
    expect(r.dominantCompanyName).toBe("Acme Corp");
  });

  it("handles multiple current roles for same company", () => {
    const r = inferCompany([
      cand("Acme Corp", "current_role", 1),
      cand("Acme Corp", "current_role", 1),
      cand("Acme Corp", "current_role", 1),
    ]);
    expect(r.needsReview).toBe(false);
    expect(r.dominantCompanyName).toBe("Acme Corp");
    expect(r.confidence).toBeGreaterThan(0.7);
  });
});

describe("findMatchingCompany", () => {
  const companies = [
    { id: "co1", name: "Acme Corp", aliases: ["acme incorporated"] },
    { id: "co2", name: "Beta Ltd", aliases: [] },
  ];

  it("finds by exact normalized name match", () => {
    const r = findMatchingCompany(companies, "acme");
    expect(r).not.toBeNull();
    expect(r!.id).toBe("co1");
  });

  it("finds by alias", () => {
    const r = findMatchingCompany(companies, "acme incorporated");
    expect(r).not.toBeNull();
    expect(r!.id).toBe("co1");
  });

  it("returns null for no match", () => {
    const r = findMatchingCompany(companies, "unknowncorp");
    expect(r).toBeNull();
  });
});
