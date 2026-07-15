// Re-export shared extraction types and helpers for the API.
export {
  safeParseGeminiExtraction,
  safeParseExtractionPayload,
  type ExtractionPayload,
} from "@crm-feed/shared";
export {
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
  type ExtractionError,
  type ExtractionErrorCategory,
} from "@crm-feed/shared";
export {
  RULES_VERSION,
  EXTRACTION_SCHEMA_VERSION,
  GEMINI_PROMPT_VERSION,
  getAppVersion,
} from "@crm-feed/shared";
export {
  normalizeGeminiExtraction,
  type NormalizedExtraction,
  type NormalizedPerson,
} from "@crm-feed/shared";
export {
  classifyConfidence,
  classifyFieldConfidence,
  type ConfidenceClass,
} from "@crm-feed/shared";
