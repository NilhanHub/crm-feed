// Extraction error classification helpers.
// Every error category has a clear code and user-friendly message.

export type ExtractionErrorCategory =
  | "missing_credentials"
  | "model_request_failed"
  | "model_timeout"
  | "malformed_json"
  | "schema_validation_failed"
  | "empty_people"
  | "partial_extraction"
  | "low_confidence"
  | "unknown";

export interface ExtractionError {
  category: ExtractionErrorCategory;
  message: string;
  retryable: boolean;
}

export const ERROR_MESSAGES: Record<ExtractionErrorCategory, string> = {
  missing_credentials: "No Gemini credentials configured. Set GEMINI_API_KEY or GOOGLE_APPLICATION_CREDENTIALS.",
  model_request_failed: "Gemini API request failed. Check network connectivity and API quota.",
  model_timeout: "Gemini API request timed out. Retry or use a smaller image.",
  malformed_json: "Gemini returned malformed JSON that could not be parsed.",
  schema_validation_failed: "Gemini output failed schema validation. The response does not match the expected extraction structure.",
  empty_people: "Extraction succeeded but no people were found in the screenshot.",
  partial_extraction: "Extraction produced partial results. Some fields may be missing or low-confidence.",
  low_confidence: "Extraction produced low-confidence results. Manual review recommended.",
  unknown: "An unknown extraction error occurred.",
};

export const RETRYABLE_ERRORS: Set<ExtractionErrorCategory> = new Set([
  "model_request_failed",
  "model_timeout",
  "unknown",
]);

export function classifyExtractionError(
  category: ExtractionErrorCategory,
  detail?: string
): ExtractionError {
  const baseMessage = ERROR_MESSAGES[category];
  const message = detail ? `${baseMessage} Detail: ${detail}` : baseMessage;
  return {
    category,
    message,
    retryable: RETRYABLE_ERRORS.has(category),
  };
}

export function isRetryable(category: ExtractionErrorCategory): boolean {
  return RETRYABLE_ERRORS.has(category);
}

export function classifyMissingCredentials(): ExtractionError {
  return classifyExtractionError("missing_credentials");
}

export function classifyMalformedJson(detail?: string): ExtractionError {
  return classifyExtractionError("malformed_json", detail);
}

export function classifySchemaValidationFailed(detail?: string): ExtractionError {
  return classifyExtractionError("schema_validation_failed", detail);
}

export function classifyModelRequestFailed(detail?: string): ExtractionError {
  return classifyExtractionError("model_request_failed", detail);
}

export function classifyModelTimeout(detail?: string): ExtractionError {
  return classifyExtractionError("model_timeout", detail);
}

export function classifyEmptyPeople(): ExtractionError {
  return classifyExtractionError("empty_people");
}

export function classifyPartialExtraction(detail?: string): ExtractionError {
  return classifyExtractionError("partial_extraction", detail);
}

export function classifyLowConfidence(detail?: string): ExtractionError {
  return classifyExtractionError("low_confidence", detail);
}

export function classifyUnknownError(detail?: string): ExtractionError {
  return classifyExtractionError("unknown", detail);
}
