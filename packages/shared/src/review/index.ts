export {
  projectLatestReviewState,
  projectLatestReviewStates,
  isLatestApproved,
  approvedPersonIds,
  getReviewHistory,
} from "./projection.js";
export {
  detectDuplicates,
  detectNameCompanyDuplicates,
  dedupeKey,
  nameCompanyKey,
  type DuplicateCandidate,
  type DuplicateDetectionResult,
} from "./dedupe.js";
export {
  selectCompanyScopedPeople,
  countExportReady,
  type SelectionInput,
  type SelectedPerson,
} from "./selection.js";
