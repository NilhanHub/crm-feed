export * from "./types/entities.js";
export {
  ExtractionPayloadSchema,
  PersonSchema,
  parseExtractionPayload,
  safeParseExtractionPayload,
  type ExtractionPayload,
  type ExtractionPerson,
  type ExtractionNamedMutual,
} from "./schema/extraction.js";
export {
  evaluateEligibility,
  computeCurrentlyAtTarget,
  dedupePeople,
  isCompanyMatchExposed,
  normalizePersonName,
  type EligibilityInput,
  type EligibilityResult,
  type DedupResult,
} from "./rules/eligibility.js";
export {
  normalizeString,
  normalizeCompanyName,
  isCompanyMatch,
  roleMatchesTargetCompany,
  personDedupKey,
} from "./rules/normalize.js";
export {
  scorePerson,
  rankPeople,
  capPeople,
  capNamedMutuals,
  MAX_PEOPLE_PER_EMAIL,
  MAX_NAMED_MUTUALS_PER_PERSON,
  type ScoredPerson,
} from "./rules/ranking.js";
export {
  formatEmailDraft,
  formatPersonBlock,
  composeEmailPeople,
  EMAIL_SIGNATURE,
  type EmailDraftPerson,
  type FormatEmailOptions,
  type ComposeInput,
} from "./email/index.js";
export {
  projectLatestReviewState,
  projectLatestReviewStates,
  isLatestApproved,
  approvedPersonIds,
  getReviewHistory,
  detectDuplicates,
  detectNameCompanyDuplicates,
  dedupeKey as reviewDedupeKey,
  nameCompanyKey,
  selectCompanyScopedPeople,
  countExportReady,
  type DuplicateCandidate,
  type DuplicateDetectionResult,
  type SelectionInput,
  type SelectedPerson,
} from "./review/index.js";
export {
  inferCompany,
  findMatchingCompany,
  type CompanyCandidate,
  type CompanyInferenceResult,
} from "./rules/companyInference.js";
export { RULES_VERSION, RULES_DESCRIPTION, EXTRACTION_SCHEMA_VERSION, GEMINI_PROMPT_VERSION, getAppVersion } from "./rules/version.js";
export * from "./extraction/index.js";
export {
  GeminiExtractionPayloadSchema,
  safeParseGeminiExtraction,
  type GeminiExtractionPayload,
  type FieldConfidence,
} from "./schema/extraction.js";
