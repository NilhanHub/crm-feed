import { describe, it, expect } from "vitest";
import {
  classifyExtractionError,
  classifyMissingCredentials,
  classifyMalformedJson,
  classifySchemaValidationFailed,
  classifyModelRequestFailed,
  classifyModelTimeout,
  classifyEmptyPeople,
  classifyPartialExtraction,
  classifyLowConfidence,
  classifyUnknownError,
  isRetryable,
  ERROR_MESSAGES,
  type ExtractionErrorCategory,
} from "../src/extraction/errors.js";

describe("error classification: missing_credentials", () => {
  it("classifies missing credentials with correct message and non-retryable", () => {
    const err = classifyMissingCredentials();
    expect(err.category).toBe("missing_credentials");
    expect(err.message).toContain("GEMINI_API_KEY");
    expect(err.retryable).toBe(false);
  });
});

describe("error classification: model_request_failed", () => {
  it("classifies model request failure as retryable", () => {
    const err = classifyModelRequestFailed("HTTP 500");
    expect(err.category).toBe("model_request_failed");
    expect(err.message).toContain("HTTP 500");
    expect(err.retryable).toBe(true);
  });
});

describe("error classification: model_timeout", () => {
  it("classifies timeout as retryable", () => {
    const err = classifyModelTimeout("30s exceeded");
    expect(err.category).toBe("model_timeout");
    expect(err.retryable).toBe(true);
  });
});

describe("error classification: malformed_json", () => {
  it("classifies malformed JSON as non-retryable", () => {
    const err = classifyMalformedJson("Unexpected token < at position 0");
    expect(err.category).toBe("malformed_json");
    expect(err.retryable).toBe(false);
  });
});

describe("error classification: schema_validation_failed", () => {
  it("classifies schema validation failure as non-retryable", () => {
    const err = classifySchemaValidationFailed("Expected string, received number at people[0].name");
    expect(err.category).toBe("schema_validation_failed");
    expect(err.retryable).toBe(false);
  });
});

describe("error classification: empty_people", () => {
  it("classifies empty people as non-retryable", () => {
    const err = classifyEmptyPeople();
    expect(err.category).toBe("empty_people");
    expect(err.retryable).toBe(false);
  });
});

describe("error classification: partial_extraction", () => {
  it("classifies partial extraction as non-retryable", () => {
    const err = classifyPartialExtraction("3 of 5 fields missing");
    expect(err.category).toBe("partial_extraction");
    expect(err.retryable).toBe(false);
  });
});

describe("error classification: low_confidence", () => {
  it("classifies low confidence as non-retryable", () => {
    const err = classifyLowConfidence("overall confidence 0.2");
    expect(err.category).toBe("low_confidence");
    expect(err.retryable).toBe(false);
  });
});

describe("error classification: unknown", () => {
  it("classifies unknown error as retryable", () => {
    const err = classifyUnknownError("something weird");
    expect(err.category).toBe("unknown");
    expect(err.retryable).toBe(true);
  });
});

describe("error classification: isRetryable", () => {
  it("returns true for retryable categories", () => {
    expect(isRetryable("model_request_failed")).toBe(true);
    expect(isRetryable("model_timeout")).toBe(true);
    expect(isRetryable("unknown")).toBe(true);
  });

  it("returns false for non-retryable categories", () => {
    expect(isRetryable("missing_credentials")).toBe(false);
    expect(isRetryable("malformed_json")).toBe(false);
    expect(isRetryable("schema_validation_failed")).toBe(false);
    expect(isRetryable("empty_people")).toBe(false);
    expect(isRetryable("partial_extraction")).toBe(false);
    expect(isRetryable("low_confidence")).toBe(false);
  });
});

describe("error classification: all categories have messages", () => {
  const categories: ExtractionErrorCategory[] = [
    "missing_credentials", "model_request_failed", "model_timeout",
    "malformed_json", "schema_validation_failed", "empty_people",
    "partial_extraction", "low_confidence", "unknown",
  ];
  for (const cat of categories) {
    it(`${cat} has a non-empty message`, () => {
      expect(ERROR_MESSAGES[cat].length).toBeGreaterThan(10);
    });
  }
});

describe("error classification: classifyExtractionError with detail", () => {
  it("appends detail to base message", () => {
    const err = classifyExtractionError("malformed_json", "Unexpected token at pos 42");
    expect(err.message).toContain("Unexpected token at pos 42");
    expect(err.message).toContain(ERROR_MESSAGES.malformed_json);
  });
});
