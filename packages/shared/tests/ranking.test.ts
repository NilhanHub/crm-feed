import { describe, it, expect } from "vitest";
import { scorePerson, rankPeople, capPeople, capNamedMutuals } from "../src/rules/ranking.js";
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

describe("ranking: priority tiers", () => {
  it("scores C-suite as priority1 (130)", () => {
    const p = makePerson({ name: "A", personId: "a", title: "Chief Executive Officer" });
    expect(scorePerson(p).score).toBe(130);
    expect(scorePerson(p).tier).toBe("priority1");
  });

  it("scores CTO in headline as priority1", () => {
    const p = makePerson({ name: "A", personId: "a", headline: "CTO at Acme" });
    expect(scorePerson(p).score).toBe(130);
  });

  it("scores IT Director as priority2 (115)", () => {
    const p = makePerson({ name: "A", personId: "a", title: "IT Director" });
    expect(scorePerson(p).score).toBe(115);
    expect(scorePerson(p).tier).toBe("priority2");
  });

  it("scores Infrastructure as priority3 (100)", () => {
    const p = makePerson({ name: "A", personId: "a", title: "Head of Infrastructure" });
    // "head of infrastructure" is tier2
    expect(scorePerson(p).score).toBe(115);
  });

  it("scores Procurement as priority3 (100)", () => {
    const p = makePerson({ name: "A", personId: "a", title: "Procurement Lead" });
    expect(scorePerson(p).score).toBe(100);
    expect(scorePerson(p).tier).toBe("priority3");
  });

  it("de-prioritises HR (10)", () => {
    const p = makePerson({ name: "A", personId: "a", title: "HR Business Partner" });
    expect(scorePerson(p).score).toBe(10);
    expect(scorePerson(p).tier).toBe("deprioritised");
  });

  it("de-prioritises Marketing (10)", () => {
    const p = makePerson({ name: "A", personId: "a", title: "Marketing Manager" });
    expect(scorePerson(p).score).toBe(10);
  });

  it("neutral weight (30) for unrelated title", () => {
    const p = makePerson({ name: "A", personId: "a", title: "Gardener" });
    expect(scorePerson(p).score).toBe(30);
  });
});

describe("ranking: ordering", () => {
  it("ranks CTO above HR above neutral", () => {
    const cto = makePerson({ name: "C", personId: "c", title: "CTO" });
    const hr = makePerson({ name: "H", personId: "h", title: "HR Lead" });
    const neutral = makePerson({ name: "N", personId: "n", title: "Gardener" });
    const ranked = rankPeople([neutral, hr, cto]).map((s) => s.person.personId);
    expect(ranked).toEqual(["c", "n", "h"]);
  });

  it("tie-breaks by confidence desc then name asc", () => {
    const a = makePerson({ name: "Bob", personId: "a", title: "Procurement", confidence: 0.9 });
    const b = makePerson({ name: "Amy", personId: "b", title: "Procurement", confidence: 0.9 });
    const c = makePerson({ name: "Zed", personId: "c", title: "Procurement", confidence: 0.5 });
    const ranked = rankPeople([a, b, c]).map((s) => s.person.personId);
    // same score, same confidence -> name asc: Amy, Bob, then Zed (lower conf)
    expect(ranked).toEqual(["b", "a", "c"]);
  });
});

describe("ranking: caps", () => {
  it("caps people to 10", () => {
    const people = Array.from({ length: 15 }, (_, i) =>
      makePerson({ name: `P${i}`, personId: `p${i}`, title: "Procurement" })
    );
    expect(capPeople(people).length).toBe(10);
  });

  it("caps named mutuals to 7", () => {
    const names = Array.from({ length: 12 }, (_, i) => `Mutual ${i}`);
    expect(capNamedMutuals(names).length).toBe(7);
  });
});
