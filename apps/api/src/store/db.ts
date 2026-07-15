import { Collection } from "./atomicStore.js";
import type {
  Company,
  IntakeBatch,
  Screenshot,
  ScreenshotBatch,
  ExtractionRun,
  ExtractedPerson,
  MutualContact,
  EligibilityDecision,
  ReviewDecision,
  CrmSyncRecord,
  EmailDraft,
  ExportBatch,
  GeminiExtractionAttempt,
  RawResponse,
  AuditEvent,
  PersonObservation,
  MasterPerson,
  EmploymentObservation,
  MutualConnectionObservation,
} from "@crm-feed/shared";

export const companies = new Collection<Company>("companies");
export const intakeBatches = new Collection<IntakeBatch>("intake_batches");
export const batches = new Collection<ScreenshotBatch>("batches");
export const screenshots = new Collection<Screenshot>("screenshots");
export const extractionRuns = new Collection<ExtractionRun>("extraction_runs");
export const extractedPeople = new Collection<ExtractedPerson>("extracted_people");
export const mutualContacts = new Collection<MutualContact>("mutual_contacts");
export const eligibilityDecisions = new Collection<EligibilityDecision>("eligibility_decisions");
export const reviewDecisions = new Collection<ReviewDecision>("review_decisions");
export const crmSyncRecords = new Collection<CrmSyncRecord>("crm_sync_records");
export const emailDrafts = new Collection<EmailDraft>("email_drafts");
export const exportBatches = new Collection<ExportBatch>("export_batches");
export const extractionAttempts = new Collection<GeminiExtractionAttempt>("extraction_attempts");
export const rawResponses = new Collection<RawResponse>("raw_responses");
export const auditEvents = new Collection<AuditEvent>("audit_events");

// --- Master Relationship Database v1 collections ---
export const personObservations = new Collection<PersonObservation>("person_observations");
export const masterPeople = new Collection<MasterPerson>("master_people");
export const employmentObservations = new Collection<EmploymentObservation>("employment_observations");
export const mutualConnectionObservations = new Collection<MutualConnectionObservation>("mutual_connection_observations");
