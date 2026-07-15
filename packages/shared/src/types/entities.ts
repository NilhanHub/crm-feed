// Core entity types for CRM Feed. The database is the single source of truth.

import type { ExtractionErrorCategory } from "../extraction/errors.js";

export type ISODateString = string;

export type ConnectionDegree = 1 | 2 | 3 | "unknown";

export type ScreenshotBatchStatus = "open" | "extraction_pending" | "extraction_done" | "archived";

export type AssignmentState = "assigned" | "unassigned" | "needs_company_review" | "mixed";

export type MutualObservationType = "named" | "vague_count";

export type EmploymentStatus = "current" | "past" | "unknown";

export type MasterPersonMergeStatus = "singleton" | "merged";

export type ExtractionRunStatus =
  | "pending_extraction"
  | "pending_credentials"
  | "in_progress"
  | "completed"
  | "failed"
  | "review_ready";

export type ExtractionProvider =
  | "gemini"
  | "vision_ocr"
  | "document_ai"
  | "manual_attach"
  | "none";

export type ReviewDecisionValue = "approved" | "rejected" | "needs_review";

export type CrmSyncStatus = "pending_export" | "exported" | "synced" | "failed" | "not_implemented";

export interface RoleEntry {
  title: string;
  company: string;
  evidenceText?: string;
}

export interface Company {
  id: string;
  name: string;
  website?: string;
  notes?: string;
  aliases?: string[];
  normalizedName?: string;
  autoCreated?: boolean;
  inferenceConfidence?: number;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface IntakeBatch {
  id: string;
  status: "processing" | "completed" | "partial" | "failed";
  screenshotsReceived: number;
  screenshotsAssigned: number;
  companiesCreated: number;
  companiesReused: number;
  unassignedCount: number;
  peopleExtracted: number;
  note?: string;
  createdAt: ISODateString;
  completedAt?: ISODateString;
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
  intakeBatchId?: string;
  inferredCompanyId?: string;
  inferenceConfidence?: number;
  needsCompanyReview?: boolean;
  assignmentState?: AssignmentState;
  extractionRunIds?: string[];
  uploadedAt: ISODateString;
}

export interface ScreenshotBatch {
  id: string;
  companyId: string;
  label?: string;
  status: ScreenshotBatchStatus;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface ExtractionRun {
  id: string;
  batchId: string;
  status: ExtractionRunStatus;
  provider: ExtractionProvider;
  providerRunId?: string;
  error?: string;
  payload?: unknown;
  screenshotIds?: string[];
  schemaValidationResult?: "valid" | "invalid" | "partial";
  startedAt?: ISODateString;
  completedAt?: ISODateString;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface NamedMutual {
  name: string;
  headline?: string;
}

export interface MutualContact {
  id: string;
  extractedPersonId: string;
  name: string;
  headline?: string;
  vagueCount?: number;
  excludedFromEmail: boolean;
  sourceScreenshotId?: string;
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
  connectionDegree?: ConnectionDegree;
  currentRoles: RoleEntry[];
  pastRoles: RoleEntry[];
  currentlyAtTargetCompany: boolean;
  sourceScreenshotIds: string[];
  confidence: number;
  fieldConfidence?: { name?: number; title?: number; location?: number; currentRoles?: number; mutualContacts?: number };
  provenance?: "gemini" | "manual_attach" | "vision_ocr" | "document_ai";
  createdAt: ISODateString;
}

export interface EligibilityDecision {
  id: string;
  extractedPersonId: string;
  eligible: boolean;
  reasons: string[];
  computedAt: ISODateString;
}

export interface ReviewDecision {
  id: string;
  extractedPersonId: string;
  decision: ReviewDecisionValue;
  note?: string;
  reviewedBy: string;
  decidedAt: ISODateString;
}

export interface CrmSyncRecord {
  id: string;
  companyId: string;
  extractedPersonId: string;
  reviewDecisionId: string;
  status: CrmSyncStatus;
  exportPath?: string;
  syncedAt?: ISODateString;
  error?: string;
  createdAt: ISODateString;
}

export interface EmailDraft {
  id: string;
  companyId: string;
  body: string;
  personIds: string[];
  rulesVersion?: string;
  createdAt: ISODateString;
}

// --- Round 2: Review state projection types ---

export interface ReviewDecisionHistory {
  extractedPersonId: string;
  decisions: ReviewDecision[];
}

export interface CurrentReviewState {
  extractedPersonId: string;
  latestDecision: ReviewDecisionValue;
  latestNote?: string;
  latestReviewedBy: string;
  latestDecidedAt: ISODateString;
  latestReviewId: string;
  historyCount: number;
}

export interface ExportBatch {
  id: string;
  companyId: string;
  companyName: string;
  includedPersonIds: string[];
  exportJsonPath: string;
  exportCsvPath: string;
  manifestPath: string;
  recordCount: number;
  rulesVersion: string;
  appVersion?: string;
  status: "exported";
  generatedAt: ISODateString;
}

export interface ExportManifest {
  exportId: string;
  paths: { json: string; csv: string };
  recordCount: number;
  rulesVersion: string;
  appVersion?: string;
  generatedAt: ISODateString;
  provenance: {
    extractedPersonId: string;
    sourceScreenshotIds: string[];
    sha256Hashes: string[];
  }[];
}

// --- Round 3: Gemini extraction types ---

export type ExtractionAttemptStatus =
  | "pending_credentials"
  | "pending_extraction"
  | "running"
  | "succeeded"
  | "failed"
  | "retrying"
  | "needs_manual_review";

// ExtractionErrorCategory is defined in extraction/errors.ts to avoid duplication.

export interface GeminiExtractionAttempt {
  id: string;
  screenshotId: string;
  extractionRunId: string;
  batchId: string;
  companyId: string;
  status: ExtractionAttemptStatus;
  errorCategory?: ExtractionErrorCategory;
  errorMessage?: string;
  retryCount: number;
  modelUsed?: string;
  promptVersion?: string;
  extractionSchemaVersion?: string;
  rulesVersion?: string;
  appCommit?: string;
  startedAt?: ISODateString;
  completedAt?: ISODateString;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface RawResponse {
  id: string;
  extractionAttemptId: string;
  screenshotId: string;
  provider: string;
  rawText: string;
  responseSize: number;
  truncated: boolean;
  storedAt: ISODateString;
}

// --- Round 5: Master Relationship Database v1 entities ---

export interface PersonObservation {
  id: string;
  observedName: string;
  normalizedName: string;
  headline?: string;
  title?: string;
  location?: string;
  connectionDegree?: ConnectionDegree;
  currentRoleText?: string;
  currentCompanyName?: string;
  currentCompanyId?: string;
  pastCompanyNames: string[];
  pastCompanyIds: string[];
  sourceScreenshotId: string;
  extractionRunId: string;
  confidence: number;
  fieldConfidence?: { name?: number; title?: number; location?: number; currentRoles?: number; mutualContacts?: number };
  evidenceText?: string;
  extractedPersonId?: string;
  createdAt: ISODateString;
  supersededAt?: ISODateString;
}

export interface MasterPerson {
  id: string;
  displayName: string;
  normalizedName: string;
  aliases: string[];
  personObservationIds: string[];
  extractedPersonIds: string[];
  companyIds: string[];
  mergeStatus: MasterPersonMergeStatus;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface EmploymentObservation {
  id: string;
  personObservationId: string;
  masterPersonId?: string;
  companyId?: string;
  companyNameObserved: string;
  roleTitle: string;
  status: EmploymentStatus;
  confidence: number;
  sourceScreenshotId: string;
  extractionRunId: string;
  evidenceText?: string;
  createdAt: ISODateString;
}

export interface MutualConnectionObservation {
  id: string;
  personObservationId: string;
  masterPersonId?: string;
  mutualName?: string;
  vagueMutualCount?: number;
  type: MutualObservationType;
  sourceScreenshotId: string;
  extractionRunId: string;
  evidenceText?: string;
  createdAt: ISODateString;
}

// --- Round 4: Audit logging, backup manifests ---

export type AuditEventType =
  | "screenshot_uploaded"
  | "manual_extraction_imported"
  | "gemini_extraction_attempted"
  | "gemini_extraction_failed"
  | "gemini_extraction_succeeded"
  | "review_decision_created"
  | "person_edited"
  | "email_generated"
  | "export_created"
  | "backup_created"
  | "bulk_approve_completed"
  | "bulk_intake_completed"
  | "intake_screenshot_uploaded"
  | "company_auto_created"
  | "master_observation_created"
  | "master_person_merged"
  | "master_db_backfilled";

export interface AuditEvent {
  id: string;
  eventType: AuditEventType;
  companyId?: string;
  batchId?: string;
  personId?: string;
  screenshotId?: string;
  attemptId?: string;
  exportId?: string;
  emailDraftId?: string;
  backupId?: string;
  actor: string;
  detail?: string;
  createdAt: ISODateString;
}

export interface BackupManifestEntry {
  /** Path relative to the data/ directory. */
  path: string;
  sizeBytes: number;
  sha256: string;
}

export interface BackupManifest {
  backupId: string;
  createdAt: ISODateString;
  appVersion: string;
  rulesVersion: string;
  entries: BackupManifestEntry[];
  totalFiles: number;
  totalBytes: number;
  note: string;
}
