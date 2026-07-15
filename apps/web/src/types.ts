export interface Company {
  id: string;
  name: string;
  website?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Screenshot {
  id: string;
  batchId: string;
  originalFilename: string;
  storedFilename: string;
  storagePath: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  uploadedAt: string;
}

export interface ScreenshotBatch {
  id: string;
  companyId: string;
  label?: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface ExtractionRun {
  id: string;
  batchId: string;
  status: string;
  provider: string;
  error?: string;
  payload?: unknown;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface MutualContact {
  id: string;
  extractedPersonId: string;
  name: string;
  headline?: string;
  vagueCount?: number;
  excludedFromEmail: boolean;
}

export interface ExtractedPerson {
  id: string;
  extractionRunId: string;
  extractionAttemptId?: string;
  companyId: string;
  name: string;
  headline?: string;
  title?: string;
  location?: string;
  connectionDegree?: number | string;
  currentRoles: { title: string; company: string }[];
  pastRoles: { title: string; company: string }[];
  currentlyAtTargetCompany: boolean;
  sourceScreenshotIds: string[];
  confidence: number;
  fieldConfidence?: { name?: number; title?: number; location?: number; currentRoles?: number; mutualContacts?: number };
  provenance?: string;
  createdAt: string;
}

export interface FieldConfidence { name?: number; title?: number; location?: number; currentRoles?: number; mutualContacts?: number }

export interface ExtractionAttempt {
  id: string;
  screenshotId: string;
  extractionRunId: string;
  batchId: string;
  companyId: string;
  status: string;
  errorCategory?: string;
  errorMessage?: string;
  retryCount: number;
  modelUsed?: string;
  promptVersion?: string;
  extractionSchemaVersion?: string;
  rulesVersion?: string;
  appCommit?: string;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RawResponse {
  id: string;
  extractionAttemptId: string;
  screenshotId: string;
  provider: string;
  rawText?: string;
  responseSize: number;
  truncated: boolean;
  storedAt: string;
}

export interface EligibilityDecision {
  id: string;
  extractedPersonId: string;
  eligible: boolean;
  reasons: string[];
  computedAt: string;
}

export interface CurrentReviewState {
  extractedPersonId: string;
  latestDecision: "approved" | "rejected" | "needs_review";
  latestNote?: string;
  latestReviewedBy: string;
  latestDecidedAt: string;
  latestReviewId: string;
  historyCount: number;
}

export interface SourceScreenshot {
  id: string;
  originalFilename: string;
  storagePath: string;
  sha256?: string;
  mimeType?: string;
  sizeBytes?: number;
}

export interface ReviewQueueItem {
  person: ExtractedPerson;
  run: ExtractionRun | null;
  eligibility: EligibilityDecision | null;
  reviewState: CurrentReviewState | null;
  mutuals: MutualContact[];
  sourceScreenshots: SourceScreenshot[];
  isDuplicateCandidate: boolean;
  rankScore: number | null;
  rankTier: string | null;
}

export interface EmailDraft {
  id: string;
  companyId: string;
  body: string;
  personIds: string[];
  rulesVersion?: string;
  createdAt: string;
}

export interface StatusCounts {
  batches: number;
  screenshotsUploaded: number;
  extractionRunsTotal: number;
  extractionRunsPending: number;
  extractionRunsWithPayload: number;
  extractedPeople: number;
  eligiblePeople: number;
  approvedPeople: number;
  rejectedPeople: number;
  duplicateCandidates: number;
  exportReadyPeople: number;
  extractionAttempts: number;
  geminiExtractedPeople: number;
}

export interface MasterDbStats {
  screenshotsStored: number;
  extractionRuns: number;
  companies: number;
  personObservations: number;
  masterPeople: number;
  employmentObservations: number;
  namedMutualObservations: number;
  vagueMutualObservations: number;
  unassignedScreenshots: number;
}

export interface MasterPerson {
  id: string;
  displayName: string;
  normalizedName: string;
  mergeStatus: string;
  aliases: string[];
  personObservationIds: string[];
  extractedPersonIds: string[];
  companyIds: string[];
}

export interface MasterPersonObservation {
  id: string;
  observedName: string;
  normalizedName: string;
  headline?: string;
  title?: string;
  location?: string;
  currentRoleText?: string;
  currentCompanyName?: string;
  confidence: number;
  sourceScreenshotId: string;
  extractionRunId: string;
  evidenceText?: string;
  createdAt: string;
}

export interface MasterEmploymentObservation {
  id: string;
  personObservationId: string;
  companyNameObserved: string;
  roleTitle: string;
  status: string;
  confidence: number;
  sourceScreenshotId: string;
  extractionRunId: string;
}

export interface MasterMutualObservation {
  id: string;
  personObservationId: string;
  mutualName?: string;
  vagueMutualCount?: number;
  type: string;
  sourceScreenshotId: string;
}

export interface ExportResult {
  exportId: string;
  company: { id: string; name: string };
  exportJson: string;
  exportCsv: string;
  manifest: string;
  recordCount: number;
  rulesVersion: string;
  note: string;
}
