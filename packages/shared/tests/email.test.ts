import { describe, it, expect } from "vitest";
import { formatEmailDraft, type EmailDraftPerson } from "../src/email/formatter.js";

function makePerson(over: Partial<EmailDraftPerson> & { id: string; name: string }): EmailDraftPerson {
  return {
    id: over.id,
    name: over.name,
    title: over.title ?? "CTO",
    headline: over.headline ?? undefined,
    location: over.location ?? "London, UK",
    currentlyAtTargetCompany: over.currentlyAtTargetCompany ?? true,
    approved: over.approved ?? true,
    currentRoles: over.currentRoles ?? [{ title: "CTO", company: "Acme" }],
    namedMutuals: over.namedMutuals ?? ["Sue Lee", "Tom Ng"],
    vagueMutualCount: over.vagueMutualCount ?? undefined,
  };
}

describe("email formatter: header and signature", () => {
  it("uses the exact greeting and signature", () => {
    const body = formatEmailDraft("Acme", []);
    expect(body).toContain("Hi Paul,");
    expect(body).toContain("I found some contacts at Acme you might be able to reach.");
    expect(body).toContain("Best,");
    expect(body).toContain("Nilhan");
  });
});

describe("email formatter: exclusions (item 19)", () => {
  it("excludes past-only people", () => {
    const p = makePerson({ id: "1", name: "Alice", currentlyAtTargetCompany: false });
    const body = formatEmailDraft("Acme", [p]);
    expect(body).not.toContain("Alice");
  });

  it("excludes people with no named mutuals", () => {
    const p = makePerson({ id: "1", name: "Alice", namedMutuals: [], vagueMutualCount: 4 });
    const body = formatEmailDraft("Acme", [p]);
    expect(body).not.toContain("Alice");
  });

  it("excludes vague mutual counts from the email text", () => {
    const p = makePerson({
      id: "1",
      name: "Alice",
      namedMutuals: ["Sue Lee"],
      vagueMutualCount: 5,
    });
    const body = formatEmailDraft("Acme", [p]);
    expect(body).not.toContain("5");
    expect(body).not.toContain("other mutual");
    expect(body).not.toContain("mutual connection");
    expect(body).toContain("Sue Lee");
  });

  it("excludes rejected people", () => {
    const p = makePerson({ id: "1", name: "Alice", approved: false });
    const body = formatEmailDraft("Acme", [p]);
    expect(body).not.toContain("Alice");
  });
});

describe("email formatter: caps (item 19)", () => {
  it("limits named mutuals to 7", () => {
    const p = makePerson({
      id: "1",
      name: "Alice",
      namedMutuals: ["M1", "M2", "M3", "M4", "M5", "M6", "M7", "M8", "M9"],
    });
    const body = formatEmailDraft("Acme", [p]);
    expect(body).toContain("M7");
    expect(body).not.toContain("M8");
    expect(body).not.toContain("M9");
  });

  it("limits people to 10", () => {
    const people = Array.from({ length: 13 }, (_, i) =>
      makePerson({ id: `p${i}`, name: `Person ${i + 1}`, namedMutuals: ["Sue"] })
    );
    const body = formatEmailDraft("Acme", people);
    expect(body).toContain("1. Person 1");
    expect(body).toContain("10. Person 10");
    expect(body).not.toContain("11. Person 11");
    expect(body).not.toContain("Person 12");
  });
});

describe("email formatter: cleanliness (item 19)", () => {
  it("uses plain names with no Markdown bold", () => {
    const p = makePerson({ id: "1", name: "Alice Tan", title: "CTO" });
    const body = formatEmailDraft("Acme", [p]);
    expect(body).not.toContain("**");
    expect(body).not.toContain("__");
    expect(body).toMatch(/1\. Alice Tan/);
  });

  it("never mentions screenshots, OCR, extraction, or analysis", () => {
    const p = makePerson({ id: "1", name: "Alice", title: "CTO" });
    const body = formatEmailDraft("Acme", [p]);
    const banned = ["screenshot", "ocr", "extract", "analysis", "found via", "image"];
    for (const word of banned) {
      expect(body.toLowerCase()).not.toContain(word);
    }
  });

  it("never prints 'no mutual contacts' wording", () => {
    // person with no mutuals is excluded; body should not mention it
    const p = makePerson({ id: "1", name: "Alice", namedMutuals: [] });
    const body = formatEmailDraft("Acme", [p]);
    expect(body.toLowerCase()).not.toContain("no mutual");
    expect(body.toLowerCase()).not.toContain("no contacts");
  });

  it("formats a full person block correctly", () => {
    const p = makePerson({
      id: "1",
      name: "Alice Tan",
      title: "Chief Technology Officer",
      location: "London, UK",
      currentRoles: [{ title: "CTO", company: "Acme" }],
      namedMutuals: ["Sue Lee", "Tom Ng"],
    });
    const body = formatEmailDraft("Acme", [p]);
    expect(body).toContain("1. Alice Tan");
    expect(body).toContain("Chief Technology Officer");
    expect(body).toContain("London, UK");
    expect(body).toContain("Current: CTO at Acme");
    expect(body).toContain("Mutual Contacts:");
    expect(body).toContain("Sue Lee");
    expect(body).toContain("Tom Ng");
    expect(body).toContain("---");
  });
});
