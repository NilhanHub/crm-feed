import type {
  Company,
  Screenshot,
  ScreenshotBatch,
  ExtractionRun,
  ExtractionAttempt,
  RawResponse,
  ReviewQueueItem,
  EmailDraft,
  StatusCounts,
  ExportResult,
} from "../types.js";

const BASE = "/api";

async function jfetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const msg = data?.detail ?? data?.error ?? `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data as T;
}

export const api = {
  health: () => jfetch<{
    status: string;
    service: string;
    time: string;
    appVersion: string;
    appCommit?: string;
    rulesVersion: string;
    extractionSchemaVersion: string;
    geminiPromptVersion: string;
    environment: string;
    deploymentMode: string;
    deployedToCloud: boolean;
    gemini: { configured: boolean; status: string; model: string; keyPresent: boolean };
    storage: {
      uploads: { path: string; readable: boolean; writable: boolean };
      db: { path: string; readable: boolean; writable: boolean; readableOk: boolean };
      exports: { path: string; readable: boolean; writable: boolean };
      backups: { path: string; readable: boolean; writable: boolean };
    };
    counts: Record<string, number>;
    lastIntegrityCheckStatus: string;
    persistence: string;
  }>(`${BASE}/health`),

  listCompanies: () => jfetch<Company[]>(`${BASE}/companies`),
  createCompany: (body: { name: string; website?: string; notes?: string }) =>
    jfetch<Company>(`${BASE}/companies`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  getCompany: (id: string) =>
    jfetch<{ company: Company; batches: ScreenshotBatch[]; extractionRuns: ExtractionRun[] }>(
      `${BASE}/companies/${id}`
    ),

  createBatch: (body: { companyId: string; label?: string }) =>
    jfetch<ScreenshotBatch>(`${BASE}/batches`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  getBatch: (id: string) =>
    jfetch<{ batch: ScreenshotBatch; screenshots: Screenshot[] }>(`${BASE}/batches/${id}`),

  uploadScreenshots: (batchId: string, files: File[]) => {
    const fd = new FormData();
    for (const f of files) fd.append("screenshots", f);
    return jfetch<{ batchId: string; screenshots: Screenshot[] }>(
      `${BASE}/batches/${batchId}/screenshots`,
      { method: "POST", body: fd }
    );
  },
  listScreenshots: (batchId: string) =>
    jfetch<Screenshot[]>(`${BASE}/batches/${batchId}/screenshots`),

  createExtractionRun: (body: { batchId: string; provider?: string }) =>
    jfetch<ExtractionRun>(`${BASE}/extraction-runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  getRun: (id: string) => jfetch<ExtractionRun>(`${BASE}/extraction-runs/${id}`),
  attachPayload: (id: string, payload: unknown) =>
    jfetch<{ run: ExtractionRun; people: unknown[]; targetCompanyName: string }>(
      `${BASE}/extraction-runs/${id}/payload`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ payload }) }
    ),

  reviewQueue: (companyId: string) =>
    jfetch<{ company: Company; items: ReviewQueueItem[] }>(`${BASE}/reviews/company/${companyId}`),
  createReview: (body: { extractedPersonId: string; decision: "approved" | "rejected" | "needs_review"; note?: string }) =>
    jfetch<{ id: string; decision: string }>(`${BASE}/reviews`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  bulkApproveEligible: (companyId: string) =>
    jfetch<{
      approvedCount: number;
      skippedCount: number;
      approvedPeople: { id: string; name: string }[];
      skippedPeople: { id: string; name: string; reason: string }[];
    }>(`${BASE}/reviews/bulk-approve-eligible/${companyId}`, {
      method: "POST",
    }),
  editPerson: (personId: string, body: {
    name?: string;
    title?: string | null;
    headline?: string | null;
    location?: string | null;
    currentRoles?: { title: string; company: string }[];
    mutualContactEdits?: { id?: string; name: string; headline?: string; action: "add" | "update" | "remove" }[];
  }) =>
    jfetch<{ person: unknown; message: string }>(`${BASE}/reviews/person/${personId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),

  statusSummary: (companyId: string) =>
    jfetch<{ company: Company; counts: StatusCounts }>(`${BASE}/status/company/${companyId}`),

  generateEmail: (companyId: string) =>
    jfetch<EmailDraft>(`${BASE}/email-drafts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyId }),
    }),

  exportRecords: (companyId: string) =>
    jfetch<ExportResult>(`${BASE}/exports`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ companyId })
    }),

  // --- Round 3: Gemini extraction ---
  extractScreenshot: (screenshotId: string, force = false) =>
    jfetch<{ screenshotId: string; status: string; attemptId?: string; peopleCreated?: number; errorCategory?: string; errorMessage?: string }>(
      `${BASE}/extraction/extract/${screenshotId}${force ? "?force=true" : ""}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ force }) }
    ),
  extractBatch: (batchId: string, force = false) =>
    jfetch<{ batchId: string; totalScreenshots: number; results: { screenshotId: string; status: string; attemptId?: string; peopleCreated?: number; errorCategory?: string; errorMessage?: string }[] }>(
      `${BASE}/extraction/extract-batch/${batchId}${force ? "?force=true" : ""}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ force }) }
    ),
  retryExtraction: (screenshotId: string) =>
    jfetch<{ screenshotId: string; status: string; attemptId?: string }>(
      `${BASE}/extraction/retry/${screenshotId}`,
      { method: "POST" }
    ),
  getScreenshotAttempts: (screenshotId: string) =>
    jfetch<{ screenshotId: string; attempts: ExtractionAttempt[] }>(
      `${BASE}/extraction/attempts/screenshot/${screenshotId}`
    ),
  getBatchAttempts: (batchId: string) =>
    jfetch<{ batchId: string; attempts: ExtractionAttempt[] }>(
      `${BASE}/extraction/attempts/batch/${batchId}`
    ),
  getAttempt: (attemptId: string) =>
    jfetch<{ attempt: ExtractionAttempt; rawResponse: RawResponse | null }>(
      `${BASE}/extraction/attempts/${attemptId}`
    ),
  getRawResponse: (attemptId: string) =>
    jfetch<RawResponse>(`${BASE}/extraction/attempts/${attemptId}/raw`),

  // --- Bulk Intake ---
  uploadBulkScreenshots: (files: File[]) => {
    const fd = new FormData();
    for (const f of files) fd.append("screenshots", f);
    return jfetch<{
      intakeBatchId: string;
      screenshotsReceived: number;
      screenshotsAssigned: number;
      companiesCreated: number;
      companiesReused: number;
      unassignedCount: number;
      peopleExtracted: number;
      assignedScreenshots: { id: string; filename: string }[];
      unassignedScreenshots: { id: string; filename: string; reason: string }[];
      warnings?: string[];
    }>(`${BASE}/intake/bulk-screenshots`, { method: "POST", body: fd });
  },
  listIntakeBatches: () =>
    jfetch<{
      id: string; status: string; screenshotsReceived: number; screenshotsAssigned: number;
      companiesCreated: number; companiesReused: number; unassignedCount: number;
      peopleExtracted: number; note?: string; createdAt: string; completedAt?: string;
    }[]>(`${BASE}/intake/batches`),
  getUnassignedScreenshots: () =>
    jfetch<{ count: number; screenshots: Screenshot[] }>(`${BASE}/intake/unassigned`),

  // --- Round 4: Audit ---
  listAuditEvents: (params?: { companyId?: string; eventType?: string; limit?: number }) => {
    const qs = new URLSearchParams();
    if (params?.companyId) qs.set("companyId", params.companyId);
    if (params?.eventType) qs.set("eventType", params.eventType);
    if (params?.limit) qs.set("limit", String(params.limit));
    const q = qs.toString();
    return jfetch<{
      total: number;
      returned: number;
      limit: number;
      events: AuditEventEntry[];
    }>(`${BASE}/audit${q ? `?${q}` : ""}`);
  },

  // --- Master Relationship Database API ---
  masterStats: () =>
    jfetch<{
      screenshotsStored: number;
      extractionRuns: number;
      companies: number;
      personObservations: number;
      masterPeople: number;
      employmentObservations: number;
      namedMutualObservations: number;
      vagueMutualObservations: number;
      unassignedScreenshots: number;
    }>(`${BASE}/master/stats`),

  masterScreenshots: () =>
    jfetch<Screenshot[]>(`${BASE}/master/screenshots`),

  masterScreenshot: (id: string) =>
    jfetch<{
      screenshot: Screenshot & { assignmentState?: string; extractionRunIds?: string[] };
      extractionRuns: { id: string; status: string; provider: string }[];
      personObservations: { id: string; observedName: string; confidence: number }[];
    }>(`${BASE}/master/screenshots/${id}`),

  masterUnassignedScreenshots: () =>
    jfetch<{ count: number; screenshots: Screenshot[] }>(`${BASE}/master/screenshots/unassigned`),

  masterCompanyPeople: (companyId: string) =>
    jfetch<{
      company: { id: string; name: string };
      people: {
        extractedPerson: { id: string; name: string; title?: string; headline?: string; location?: string; currentlyAtTargetCompany: boolean; confidence: number };
        observations: { id: string; observedName: string; normalizedName: string; confidence: number; createdAt: string }[];
        employmentObservations: { id: string; roleTitle: string; companyNameObserved: string; status: string }[];
        mutualConnectionObservations: { id: string; mutualName?: string; vagueMutualCount?: number; type: string }[];
        sourceScreenshots: { id: string; originalFilename: string; sha256: string }[];
        extractionRun: { id: string; status: string; provider: string } | null;
      }[];
      totalCount: number;
    }>(`${BASE}/master/companies/${companyId}/people`),

  masterPeople: () =>
    jfetch<{
      masterPeople: {
        masterPerson: { id: string; displayName: string; normalizedName: string; mergeStatus: string; aliases: string[] };
        observations: { id: string; observedName: string; confidence: number }[];
        employmentObservations: { roleTitle: string; companyNameObserved: string; status: string }[];
        mutualConnectionObservations: { mutualName?: string; vagueMutualCount?: number; type: string }[];
      }[];
      totalCount: number;
    }>(`${BASE}/master/people`),

  masterPerson: (id: string) =>
    jfetch<{
      masterPerson: { id: string; displayName: string; normalizedName: string; mergeStatus: string; aliases: string[]; personObservationIds: string[]; extractedPersonIds: string[]; companyIds: string[] };
      observations: { id: string; observedName: string; normalizedName: string; headline?: string; title?: string; location?: string; currentCompanyName?: string; currentRoleText?: string; confidence: number; sourceScreenshotId: string; extractionRunId: string; evidenceText?: string; createdAt: string }[];
      employmentObservations: { id: string; personObservationId: string; companyNameObserved: string; roleTitle: string; status: string; confidence: number; sourceScreenshotId: string; extractionRunId: string }[];
      mutualConnectionObservations: { id: string; personObservationId: string; mutualName?: string; vagueMutualCount?: number; type: string; sourceScreenshotId: string }[];
      sourceScreenshots: { id: string; originalFilename: string; sha256: string }[];
      extractionRuns: { id: string; status: string; provider: string }[];
      reviewDecisions: { id: string; decision: string; reviewedBy: string; decidedAt: string }[];
      identityNote: string;
    }>(`${BASE}/master/people/${id}`),

  masterObservations: (params?: { personId?: string; companyId?: string; screenshotId?: string }) => {
    const qs = new URLSearchParams();
    if (params?.personId) qs.set("personId", params.personId);
    if (params?.companyId) qs.set("companyId", params.companyId);
    if (params?.screenshotId) qs.set("screenshotId", params.screenshotId);
    const q = qs.toString();
    return jfetch<{
      observations: { id: string; observedName: string; normalizedName: string; currentCompanyName?: string; confidence: number; sourceScreenshotId: string; extractionRunId: string }[];
      employmentObservations: { personObservationId: string; roleTitle: string; companyNameObserved: string; status: string }[];
      mutualConnectionObservations: { personObservationId: string; mutualName?: string; type: string }[];
      totalCount: number;
    }>(`${BASE}/master/observations${q ? `?${q}` : ""}`);
  },

  masterBackfill: () =>
    jfetch<{ success: boolean; personObservationsCreated: number; masterPeopleCreated: number }>(
      `${BASE}/master/backfill`, { method: "POST" }
    ),
};

export interface AuditEventEntry {
  id: string;
  eventType: string;
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
  createdAt: string;
}
