import { useCallback, useEffect, useState } from "react";
import { api } from "./api/client.js";
import type { AuditEventEntry } from "./api/client.js";
import type {
  Company,
  ScreenshotBatch,
  ExtractionRun,
  Screenshot,
  ReviewQueueItem,
  EmailDraft,
  StatusCounts,
  ExportResult,
  ExtractionAttempt,
} from "./types.js";
import { EmptyState } from "./components/EmptyState.js";
import { useToast } from "./components/Toast.js";
import { MasterDbPanel } from "./components/MasterDbPanel.js";

const STATUS_TAG: Record<string, string> = {
  pending_credentials: "warn",
  pending_extraction: "warn",
  in_progress: "accent",
  completed: "ok",
  failed: "bad",
  review_ready: "ok",
};

type ReviewFilter = "all" | "approved" | "rejected" | "needs_review" | "eligible";

export default function App() {
  const { show, toastNode } = useToast();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<{
    company: Company;
    batches: ScreenshotBatch[];
    extractionRuns: ExtractionRun[];
  } | null>(null);
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);
  const [batchDetail, setBatchDetail] = useState<{
    batch: ScreenshotBatch;
    screenshots: Screenshot[];
  } | null>(null);
  const [queue, setQueue] = useState<ReviewQueueItem[]>([]);
  const [statusCounts, setStatusCounts] = useState<StatusCounts | null>(null);
  const [emailDraft, setEmailDraft] = useState<EmailDraft | null>(null);
  const [exportResult, setExportResult] = useState<ExportResult | null>(null);
  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>("all");
  const [loading, setLoading] = useState(false);
  const [fetchKey, setFetchKey] = useState(0);
  const [showBulkIntake, setShowBulkIntake] = useState(false);
  const [bulkIntakeLoading, setBulkIntakeLoading] = useState(false);
  const [bulkIntakeResult, setBulkIntakeResult] = useState<{
    intakeBatchId: string; screenshotsReceived: number; screenshotsAssigned: number;
    companiesCreated: number; companiesReused: number; unassignedCount: number;
    peopleExtracted: number; assignedScreenshots: { id: string; filename: string }[];
    unassignedScreenshots: { id: string; filename: string; reason: string }[];
    warnings?: string[];
  } | null>(null);

  const refreshCompanies = useCallback(async () => {
    try { setCompanies(await api.listCompanies()); } catch (e) { show((e as Error).message, "bad"); }
  }, [show]);

  const refreshDetail = useCallback(async (id: string) => {
    try { setDetail(await api.getCompany(id)); } catch (e) { show((e as Error).message, "bad"); }
  }, [show]);

  const refreshQueue = useCallback(async (id: string) => {
    try {
      const q = await api.reviewQueue(id);
      setQueue(q.items);
    } catch (e) { show((e as Error).message, "bad"); }
  }, [show]);

  const refreshStatus = useCallback(async (id: string) => {
    try {
      const s = await api.statusSummary(id);
      setStatusCounts(s.counts);
    } catch { /* status summary is non-critical */ }
  }, []);

  const refreshBatch = useCallback(async (id: string) => {
    try { setBatchDetail(await api.getBatch(id)); } catch (e) { show((e as Error).message, "bad"); }
  }, [show]);

  useEffect(() => { void refreshCompanies(); }, [refreshCompanies]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null); setQueue([]); setEmailDraft(null); setSelectedBatchId(null);
      setBatchDetail(null); setStatusCounts(null); setExportResult(null);
      return;
    }
    void refreshDetail(selectedId);
    void refreshQueue(selectedId);
    void refreshStatus(selectedId);
  }, [selectedId, refreshDetail, refreshQueue, refreshStatus]);

  useEffect(() => {
    if (!selectedBatchId) { setBatchDetail(null); return; }
    void refreshBatch(selectedBatchId);
  }, [selectedBatchId, refreshBatch]);

  const company = detail?.company ?? null;

  const filteredQueue = queue.filter((item) => {
    if (reviewFilter === "all") return true;
    if (reviewFilter === "eligible") return item.eligibility?.eligible ?? false;
    const state = item.reviewState?.latestDecision ?? "needs_review";
    return state === reviewFilter;
  });

  const eligibleUnapprovedCount = queue.filter(
    (item) => item.eligibility?.eligible && item.reviewState?.latestDecision !== "approved"
  ).length;

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="logo">CF</div>
          <div>
            <div className="name">CRM Feed</div>
            <div className="sub">Review Console</div>
          </div>
        </div>

        <CreateCompanyForm
          onCreated={async (c) => { await refreshCompanies(); setSelectedId(c.id); setFetchKey((k) => k + 1); show("Company created", "ok"); }}
          onError={(m) => show(m, "bad")}
        />

        <div>
          <div className="section-title">Companies</div>
          {companies.length === 0 ? (
            <div className="faint" style={{ fontSize: 12 }}>No companies yet.</div>
          ) : (
            <div className="company-list">
              {companies.map((c) => (
                <div key={c.id} className={`company-item ${selectedId === c.id ? "active" : ""}`} onClick={() => setSelectedId(c.id)}>
                  <span className="nm">{c.name}</span>
                  <span className="mt mono">{c.id.slice(0, 14)}…</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="divider" />
        <button className="primary" style={{ width: "100%" }} onClick={() => { setShowBulkIntake((v) => !v); setBulkIntakeResult(null); }}>
          {showBulkIntake ? "Close bulk intake" : "Bulk intake"}
        </button>

        <div className="faint" style={{ marginTop: "auto", fontSize: 11 }}>
          No scraping · manual uploads only
        </div>
      </aside>

      <main className="main">
        {showBulkIntake ? (
          <BulkIntakePanel
            loading={bulkIntakeLoading}
            result={bulkIntakeResult}
            onUpload={async (files) => {
              setBulkIntakeLoading(true);
              setBulkIntakeResult(null);
              try {
                const r = await api.uploadBulkScreenshots(files);
                setBulkIntakeResult(r);
                if (r.companiesCreated > 0 || r.companiesReused > 0) {
                  await refreshCompanies();
                }
                show(`Intake complete: ${r.screenshotsAssigned} assigned, ${r.unassignedCount} unassigned`, r.unassignedCount > 0 ? "info" : "ok");
              } catch (e) {
                show((e as Error).message, "bad");
              } finally {
                setBulkIntakeLoading(false);
              }
            }}
            onReset={() => setBulkIntakeResult(null)}
          />
        ) : !company ? (
          <HeroEmpty />
        ) : (
          <>
            <div className="page-head">
              <h1>{company.name}</h1>
              <p>
                {company.website && <span>{company.website} · </span>}
                <span className="mono faint">{company.id}</span>
              </p>
            </div>

            {statusCounts && <StatusDashboard counts={statusCounts} />}

            <div className="divider" />

            <div className="grid two">
              <BatchPanel
                companyId={company.id}
                batches={detail?.batches ?? []}
                runs={detail?.extractionRuns ?? []}
                selectedBatchId={selectedBatchId}
                onSelect={(id) => setSelectedBatchId(id)}
                onCreated={async () => { await refreshDetail(company.id); setFetchKey((k) => k + 1); show("Batch created", "ok"); }}
                onError={(m) => show(m, "bad")}
              />
              <ScreenshotPanel
                batchDetail={batchDetail}
                onUploaded={async () => { if (selectedBatchId) { await refreshBatch(selectedBatchId); setFetchKey((k) => k + 1); } show("Screenshots uploaded", "ok"); }}
                onError={(m) => show(m, "bad")}
              />
            </div>

            <div className="divider" />

            <ExtractionPanel
              batches={detail?.batches ?? []}
              runs={detail?.extractionRuns ?? []}
              fetchKey={fetchKey}
              onRunCreated={async () => {
                if (selectedId) { await refreshDetail(selectedId); setFetchKey((k) => k + 1); }
                show("Extraction run created (pending)", "ok");
              }}
              onPayloadAttached={async () => {
                if (selectedId) { await refreshDetail(selectedId); await refreshQueue(selectedId); await refreshStatus(selectedId); setFetchKey((k) => k + 1); }
                show("Payload attached — review queue updated", "ok");
              }}
              onError={(m) => show(m, "bad")}
            />

            <div className="divider" />

            <ReviewQueuePanel
              items={filteredQueue}
              totalCount={queue.length}
              filter={reviewFilter}
              eligibleUnapprovedCount={eligibleUnapprovedCount}
              companyId={company.id}
              onFilterChange={setReviewFilter}
              onDecided={async () => {
                if (selectedId) { await refreshQueue(selectedId); await refreshStatus(selectedId); setFetchKey((k) => k + 1); }
                show("Review saved", "ok");
              }}
              onEdited={async () => {
                if (selectedId) { await refreshQueue(selectedId); await refreshStatus(selectedId); setFetchKey((k) => k + 1); }
                show("Person edited", "ok");
              }}
              onError={(m) => show(m, "bad")}
            />

            <div className="divider" />

            <div className="grid two">
              <EmailPanel
                draft={emailDraft}
                exportReadyCount={statusCounts?.exportReadyPeople ?? 0}
                onGenerate={async () => {
                  try {
                    setLoading(true);
                    const d = await api.generateEmail(company.id);
                    setEmailDraft(d);
                    show("Email draft generated", "ok");
                  } catch (e) { show((e as Error).message, "bad"); }
                  finally { setLoading(false); }
                }}
                loading={loading}
              />
              <ExportPanel
                result={exportResult}
                exportReadyCount={statusCounts?.exportReadyPeople ?? 0}
                onExport={async () => {
                  try {
                    setLoading(true);
                    const r = await api.exportRecords(company.id);
                    setExportResult(r);
                    show(`Exported ${r.recordCount} record(s)`, "ok");
                  } catch (e) { show((e as Error).message, "bad"); }
                  finally { setLoading(false); }
                }}
                loading={loading}
              />
            </div>

            <div className="divider" />

            <DiagnosticsPanel />
            <AuditPanel companyId={company.id} fetchKey={fetchKey} />
            <div className="divider" />
            <MasterDbPanel companies={companies} fetchKey={fetchKey} />
          </>
        )}
        {!company && (
          <>
            <div className="divider" />
            <MasterDbPanel companies={companies} fetchKey={fetchKey} />
          </>
        )}
      </main>
      {toastNode}
    </div>
  );
}

function HeroEmpty() {
  return (
    <div className="page-head">
      <h1>CRM Feed</h1>
      <p>Convert manually uploaded LinkedIn screenshots into reviewed CRM-ready contacts.</p>
      <div className="card" style={{ marginTop: 18 }}>
        <EmptyState title="Select or create a company to begin" hint="Create a target company on the left, then upload a screenshot batch." />
      </div>
    </div>
  );
}

function StatusDashboard({ counts }: { counts: StatusCounts }) {
  const items = [
    { label: "Batches", value: counts.batches },
    { label: "Screenshots", value: counts.screenshotsUploaded },
    { label: "Runs (pending)", value: counts.extractionRunsPending },
    { label: "Runs (payload)", value: counts.extractionRunsWithPayload },
    { label: "People", value: counts.extractedPeople },
    { label: "Eligible", value: counts.eligiblePeople },
    { label: "Approved", value: counts.approvedPeople },
    { label: "Rejected", value: counts.rejectedPeople },
    { label: "Duplicates", value: counts.duplicateCandidates },
    { label: "Export-ready", value: counts.exportReadyPeople },
    { label: "Extraction attempts", value: counts.extractionAttempts ?? 0 },
    { label: "Gemini people", value: counts.geminiExtractedPeople ?? 0 },
  ];
  return (
    <div className="card" style={{ marginBottom: 0 }}>
      <h2>Status Summary</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))", gap: 10 }}>
        {items.map((it) => (
          <div key={it.label} style={{ textAlign: "center", padding: "8px 4px", background: "var(--bg)", borderRadius: 8, border: "1px solid var(--border-soft)" }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: it.label === "Export-ready" && it.value > 0 ? "var(--ok)" : "var(--text)" }}>{it.value}</div>
            <div className="faint" style={{ fontSize: 11 }}>{it.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function CreateCompanyForm({ onCreated, onError }: { onCreated: (c: Company) => void; onError: (m: string) => void; }) {
  const [name, setName] = useState("");
  const [website, setWebsite] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div>
      <div className="section-title">New company</div>
      <div className="field">
        <label>Company name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Corp" />
      </div>
      <div className="field">
        <label>Website (optional)</label>
        <input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://acme.com" />
      </div>
      <button className="primary" disabled={busy || !name.trim()} onClick={async () => {
        setBusy(true);
        try { const c = await api.createCompany({ name: name.trim(), website: website.trim() || undefined }); setName(""); setWebsite(""); onCreated(c); }
        catch (e) { onError((e as Error).message); } finally { setBusy(false); }
      }}>Create company</button>
    </div>
  );
}

function BatchPanel({ companyId, batches, runs, selectedBatchId, onSelect, onCreated, onError }: {
  companyId: string; batches: ScreenshotBatch[]; runs: ExtractionRun[];
  selectedBatchId: string | null; onSelect: (id: string) => void; onCreated: () => void; onError: (m: string) => void;
}) {
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const companyBatches = batches.filter((b) => b.companyId === companyId);
  return (
    <div className="card">
      <h2>Screenshot batches</h2>
      <div className="row">
        <div className="field">
          <label>Batch label (optional)</label>
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Q3 intake" />
        </div>
        <button className="primary" disabled={busy} onClick={async () => {
          setBusy(true);
          try { await api.createBatch({ companyId, label: label.trim() || undefined }); setLabel(""); onCreated(); }
          catch (e) { onError((e as Error).message); } finally { setBusy(false); }
        }}>New batch</button>
      </div>
      <div className="divider" />
      {companyBatches.length === 0 ? (
        <EmptyState title="No batches yet" hint="Create a batch to group screenshot uploads." />
      ) : (
        <div className="list">
          {companyBatches.map((b) => {
            const run = runs.find((r) => r.batchId === b.id) ?? null;
            return (
              <div key={b.id} className="list-row" style={{ cursor: "pointer", borderColor: selectedBatchId === b.id ? "var(--accent)" : undefined }} onClick={() => onSelect(b.id)}>
                <div style={{ flex: 1 }}>
                  <div>{b.label ?? "Untitled batch"}</div>
                  <div className="meta">{b.status} · {b.id.slice(0, 16)}{run && ` · run: ${run.status}`}</div>
                </div>
                <span className={`tag ${STATUS_TAG[b.status] ?? ""}`}>{b.status}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ScreenshotPanel({ batchDetail, onUploaded, onError }: {
  batchDetail: { batch: ScreenshotBatch; screenshots: Screenshot[] } | null;
  onUploaded: () => void; onError: (m: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  if (!batchDetail) {
    return <div className="card"><h2>Screenshots</h2><EmptyState title="Select a batch" hint="Choose a batch on the left to upload screenshots." /></div>;
  }
  const { batch, screenshots } = batchDetail;
  return (
    <div className="card">
      <h2>Screenshots — {batch.label ?? "Untitled batch"}</h2>
      <div className="toolbar">
        <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple onChange={async (e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length === 0) return;
          setBusy(true);
          try { await api.uploadScreenshots(batch.id, files); onUploaded(); }
          catch (e) { onError((e as Error).message); } finally { setBusy(false); e.target.value = ""; }
        }} />
        <button disabled={busy}>{busy ? "Uploading…" : "Upload selected"}</button>
      </div>
      {screenshots.length === 0 ? (
        <EmptyState title="No screenshots uploaded" hint="Screenshots are stored permanently under data/uploads." />
      ) : (
        <div className="screenshots">
          {screenshots.map((s) => (
            <div className="shot-card" key={s.id}>
              <img src={`/data/uploads/${s.storedFilename}`} alt={s.originalFilename} />
              <div className="shot-meta">{s.originalFilename}<br />{Math.round(s.sizeBytes / 1024)} KB · sha {s.sha256.slice(0, 10)}</div>
            </div>
          ))}
        </div>
      )}
      <p className="faint" style={{ marginTop: 10, fontSize: 12 }}>Originals are kept permanently. Provenance is preserved internally and never shown in Paul emails.</p>
    </div>
  );
}

function ExtractionPanel({ batches, runs, fetchKey, onRunCreated, onPayloadAttached, onError }: {
  batches: ScreenshotBatch[]; runs: ExtractionRun[];
  fetchKey: number;
  onRunCreated: () => void; onPayloadAttached: () => void; onError: (m: string) => void;
}) {
  const [batchId, setBatchId] = useState<string>("");
  const [payloadText, setPayloadText] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [payloadError, setPayloadError] = useState<string | null>(null);
  const [batchScreenshots, setBatchScreenshots] = useState<Screenshot[]>([]);
  const [attempts, setAttempts] = useState<ExtractionAttempt[]>([]);
  const [extractBusy, setExtractBusy] = useState<Record<string, boolean>>({});
  const [expandedShot, setExpandedShot] = useState<string | null>(null);

  useEffect(() => { if (!batchId && batches.length > 0) setBatchId(batches[0]!.id); }, [batches, batchId]);

  useEffect(() => {
    if (!batchId) { setBatchScreenshots([]); setAttempts([]); return; }
    api.getBatch(batchId).then((d) => setBatchScreenshots(d.screenshots)).catch(() => {});
    api.getBatchAttempts(batchId).then((d) => setAttempts(d.attempts)).catch(() => {});
  }, [batchId, fetchKey]);

  const selectedRuns = runs.filter((r) => r.batchId === batchId);
  const latestRun = selectedRuns[selectedRuns.length - 1] ?? null;
  const anyExtractBusy = Object.values(extractBusy).some(Boolean);

  const getShotStatus = (sid: string): { status: string; attempt: ExtractionAttempt | null } => {
    const shotAttempts = attempts.filter((a) => a.screenshotId === sid).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const last = shotAttempts[0] ?? null;
    return { status: last?.status ?? "pending_extraction", attempt: last };
  };

  const runExtract = async (screenshotId: string, force = false) => {
    setExtractBusy((p) => ({ ...p, [screenshotId]: true }));
    try {
      const r = await api.extractScreenshot(screenshotId, force);
      await api.getBatchAttempts(batchId).then((d) => setAttempts(d.attempts));
      if (r.status === "succeeded") onPayloadAttached();
    } catch (e) { onError((e as Error).message); }
    finally { setExtractBusy((p) => ({ ...p, [screenshotId]: false })); }
  };

  const runBatchExtract = async (force = false) => {
    setBusy(true);
    try {
      const r = await api.extractBatch(batchId, force);
      await api.getBatchAttempts(batchId).then((d) => setAttempts(d.attempts));
      if (r.results.some((res) => res.status === "succeeded")) onPayloadAttached();
    } catch (e) { onError((e as Error).message); }
    finally { setBusy(false); }
  };

  const STATUS_CLASS: Record<string, string> = {
    pending_credentials: "warn", pending_extraction: "warn", running: "accent",
    succeeded: "ok", failed: "bad", retrying: "warn", needs_manual_review: "warn",
  };

  return (
    <div className="card">
      <h2>Extraction</h2>
      <div className="row">
        <div className="field">
          <label>Batch</label>
          <select value={batchId} onChange={(e) => setBatchId(e.target.value)}>
            {batches.length === 0 && <option value="">No batches</option>}
            {batches.map((b) => <option key={b.id} value={b.id}>{b.label ?? b.id.slice(0, 12)}</option>)}
          </select>
        </div>
        <button className="primary" disabled={busy || !batchId} onClick={async () => {
          setBusy(true);
          try { await api.createExtractionRun({ batchId }); onRunCreated(); }
          catch (e) { onError((e as Error).message); } finally { setBusy(false); }
        }}>Create run</button>
      </div>

      {latestRun && (
        <div className="list-row" style={{ marginTop: 12 }}>
          <div style={{ flex: 1 }}>
            <div>Run {latestRun.id.slice(0, 18)}…</div>
            <div className="meta">provider: {latestRun.provider} · {latestRun.status}{latestRun.error && ` · ${latestRun.error}`}</div>
          </div>
          <span className={`tag ${STATUS_TAG[latestRun.status] ?? ""}`}>{latestRun.status}</span>
        </div>
      )}

      {batchScreenshots.length > 0 && (
        <>
          <div className="divider" />
          <div className="toolbar">
            <strong style={{ fontSize: 12 }}>Gemini Extraction</strong>
            <button disabled={busy || anyExtractBusy || batchScreenshots.length === 0} onClick={() => runBatchExtract(false)}>
              {busy ? "Extracting…" : `Extract all (${batchScreenshots.length})`}
            </button>
            <button className="ghost" disabled={busy || anyExtractBusy || batchScreenshots.length === 0} onClick={() => runBatchExtract(true)}>
              Force re-extract all
            </button>
          </div>
          <div className="list" style={{ marginTop: 8 }}>
            {batchScreenshots.map((shot) => {
              const { status, attempt } = getShotStatus(shot.id);
              const isBusy = extractBusy[shot.id] ?? false;
              const isExpanded = expandedShot === shot.id;
              return (
                <div key={shot.id} className="list-row" style={{ flexDirection: "column", alignItems: "stretch" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ flex: 1, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {shot.originalFilename}
                    </span>
                    <span className={`tag ${STATUS_CLASS[status] ?? ""}`} style={{ fontSize: 10 }}>{status}</span>
                    <button style={{ fontSize: 11, padding: "2px 8px" }} disabled={isBusy} onClick={() => runExtract(shot.id, false)}>
                      Extract
                    </button>
                    {status === "failed" && (
                      <button className="ghost" style={{ fontSize: 11, padding: "2px 8px" }} disabled={isBusy} onClick={() => runExtract(shot.id, true)}>
                        Retry
                      </button>
                    )}
                    <button className="ghost" style={{ fontSize: 10, padding: "2px 6px" }} onClick={() => setExpandedShot(isExpanded ? null : shot.id)}>
                      {isExpanded ? "▲" : "▼"}
                    </button>
                  </div>
                  {isExpanded && attempt && (
                    <div style={{ fontSize: 11, marginTop: 6, padding: 8, background: "var(--bg)", borderRadius: 6 }}>
                      <div><strong>Attempt:</strong> {attempt.id.slice(0, 16)}…</div>
                      <div><strong>Status:</strong> {attempt.status}</div>
                      {attempt.errorCategory && <div><strong>Error:</strong> {attempt.errorCategory}{attempt.errorMessage && ` — ${attempt.errorMessage}`}</div>}
                      {attempt.modelUsed && <div><strong>Model:</strong> {attempt.modelUsed}</div>}
                      {attempt.retryCount > 0 && <div><strong>Retries:</strong> {attempt.retryCount}</div>}
                      {attempt.startedAt && <div><strong>Started:</strong> {attempt.startedAt}</div>}
                      {attempt.completedAt && <div><strong>Completed:</strong> {attempt.completedAt}</div>}
                      {attempt.promptVersion && <div><strong>Prompt:</strong> v{attempt.promptVersion}</div>}
                      {attempt.extractionSchemaVersion && <div><strong>Schema:</strong> v{attempt.extractionSchemaVersion}</div>}
                    </div>
                  )}
                  {isExpanded && !attempt && (
                    <div style={{ fontSize: 11, marginTop: 6, padding: 8, background: "var(--bg)", borderRadius: 6, color: "var(--faint)" }}>
                      No extraction attempts yet. Click Extract to run Gemini extraction.
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {batchScreenshots.length === 0 && batchId && (
        <div style={{ marginTop: 12 }}>
          <EmptyState title="No screenshots uploaded" hint="Upload screenshots first, then extract them with Gemini." />
        </div>
      )}

      <div className="divider" />
      <div className="field">
        <label>Manual JSON payload (fallback, separate from Gemini)</label>
        <textarea rows={6} value={payloadText} onChange={(e) => { setPayloadText(e.target.value); setPayloadError(null); }}
          placeholder='{ "targetCompanyName": "Acme", "extractionMeta": { "provider": "manual_attach" }, "people": [ ... ] }'
          style={{ fontFamily: "var(--mono)", fontSize: 12, borderColor: payloadError ? "var(--bad)" : undefined }} />
        {payloadError && <div style={{ color: "var(--bad)", fontSize: 12, marginTop: 4 }}>{payloadError}</div>}
      </div>
      <button disabled={busy || !latestRun || !payloadText.trim()} onClick={async () => {
        if (!latestRun) return;
        let parsed: unknown;
        try { parsed = JSON.parse(payloadText); } catch (e) { setPayloadError(`Invalid JSON: ${(e as Error).message}`); return; }
        setBusy(true);
        try { await api.attachPayload(latestRun.id, parsed); setPayloadText(""); setPayloadError(null); onPayloadAttached(); }
        catch (e) { setPayloadError((e as Error).message); onError((e as Error).message); }
        finally { setBusy(false); }
      }}>Attach payload</button>
    </div>
  );
}

function ReviewQueuePanel({ items, totalCount, filter, eligibleUnapprovedCount, companyId, onFilterChange, onDecided, onEdited, onError }: {
  items: ReviewQueueItem[]; totalCount: number; filter: ReviewFilter;
  eligibleUnapprovedCount: number; companyId: string;
  onFilterChange: (f: ReviewFilter) => void;
  onDecided: () => void; onEdited: () => void; onError: (m: string) => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  const filters: { label: string; value: ReviewFilter }[] = [
    { label: "All", value: "all" },
    { label: "Eligible", value: "eligible" },
    { label: "Approved", value: "approved" },
    { label: "Rejected", value: "rejected" },
    { label: "Needs Review", value: "needs_review" },
  ];

  const handleBulkApprove = async () => {
    if (eligibleUnapprovedCount === 0) return;
    const ok = window.confirm(
      `Approve ${eligibleUnapprovedCount} eligible people?\n\nThis will approve all eligible people in the review queue that have not been reviewed yet.\n\nRejected and needs-review people will not be changed.`
    );
    if (!ok) return;
    setBulkBusy(true);
    try {
      const result = await api.bulkApproveEligible(companyId);
      const msg = `Bulk approved: ${result.approvedCount} approved, ${result.skippedCount} skipped`;
      onDecided();
      // Show toast-like feedback via alert for simplicity
      alert(msg);
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBulkBusy(false);
    }
  };

  return (
    <div className="card">
      <h2>Review queue {totalCount > 0 && <span className="faint" style={{ fontSize: 12 }}>({items.length} shown of {totalCount})</span>}</h2>
      <div className="toolbar">
        {filters.map((f) => (
          <button key={f.value} className={filter === f.value ? "primary" : "ghost"} onClick={() => onFilterChange(f.value)} style={{ padding: "6px 12px" }}>
            {f.label}
          </button>
        ))}
        <span style={{ flex: 1 }} />
        <button
          className="primary"
          disabled={eligibleUnapprovedCount === 0 || bulkBusy}
          onClick={handleBulkApprove}
          style={{ padding: "6px 12px" }}
        >
          {bulkBusy ? "Approving…" : `Approve all eligible (${eligibleUnapprovedCount})`}
        </button>
      </div>
      {totalCount === 0 ? (
        <EmptyState title="No extracted people yet" hint="Attach a real extraction payload to populate reviewable people. No sample/fake people are shown." />
      ) : items.length === 0 ? (
        <EmptyState title="No people match this filter" hint="Try a different filter." />
      ) : (
        <div className="list">
          {items.map(({ person, eligibility, reviewState, mutuals, sourceScreenshots, isDuplicateCandidate, rankScore, rankTier }) => {
            const namedMutuals = mutuals.filter((m) => !m.excludedFromEmail && m.name !== "__vague_count__");
            const vague = mutuals.find((m) => m.excludedFromEmail && m.name === "__vague_count__");
            const isEditing = editingId === person.id;
            return (
              <ReviewCard
                key={person.id}
                person={person}
                eligibility={eligibility}
                reviewState={reviewState}
                namedMutuals={namedMutuals}
                vague={vague}
                sourceScreenshots={sourceScreenshots}
                isDuplicateCandidate={isDuplicateCandidate}
                rankScore={rankScore}
                rankTier={rankTier}
                isEditing={isEditing}
                busy={busyId === person.id}
                onApprove={async () => {
                  setBusyId(person.id);
                  try { await api.createReview({ extractedPersonId: person.id, decision: "approved" }); onDecided(); }
                  catch (e) { onError((e as Error).message); } finally { setBusyId(null); }
                }}
                onReject={async () => {
                  setBusyId(person.id);
                  try { await api.createReview({ extractedPersonId: person.id, decision: "rejected" }); onDecided(); }
                  catch (e) { onError((e as Error).message); } finally { setBusyId(null); }
                }}
                onNeedsReview={async () => {
                  setBusyId(person.id);
                  try { await api.createReview({ extractedPersonId: person.id, decision: "needs_review" }); onDecided(); }
                  catch (e) { onError((e as Error).message); } finally { setBusyId(null); }
                }}
                onEditToggle={() => setEditingId(isEditing ? null : person.id)}
                onEditSave={async (edits) => {
                  setBusyId(person.id);
                  try { await api.editPerson(person.id, edits); setEditingId(null); onEdited(); }
                  catch (e) { onError((e as Error).message); } finally { setBusyId(null); }
                }}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function ReviewCard({ person, eligibility, reviewState, namedMutuals, vague, sourceScreenshots, isDuplicateCandidate, rankScore, rankTier, isEditing, busy, onApprove, onReject, onNeedsReview, onEditToggle, onEditSave }: {
  person: ReviewQueueItem["person"];
  eligibility: ReviewQueueItem["eligibility"];
  reviewState: ReviewQueueItem["reviewState"];
  namedMutuals: ReviewQueueItem["mutuals"];
  vague?: ReviewQueueItem["mutuals"][number];
  sourceScreenshots: ReviewQueueItem["sourceScreenshots"];
  isDuplicateCandidate: boolean;
  rankScore: number | null;
  rankTier: string | null;
  isEditing: boolean;
  busy: boolean;
  onApprove: () => void;
  onReject: () => void;
  onNeedsReview: () => void;
  onEditToggle: () => void;
  onEditSave: (edits: { name?: string; title?: string; location?: string; currentRoles?: { title: string; company: string }[]; mutualContactEdits?: { name: string; action: "add" }[] }) => void;
}) {
  const [editName, setEditName] = useState(person.name);
  const [editTitle, setEditTitle] = useState(person.title ?? "");
  const [editLocation, setEditLocation] = useState(person.location ?? "");
  const [editRole, setEditRole] = useState(person.currentRoles[0]?.title ?? "");
  const [editCompany, setEditCompany] = useState(person.currentRoles[0]?.company ?? "");
  const [editMutuals, setEditMutuals] = useState("");
  const [showConfidence, setShowConfidence] = useState(false);

  const latestDecision = reviewState?.latestDecision ?? "needs_review";
  const decisionTag = latestDecision === "approved" ? "ok" : latestDecision === "rejected" ? "bad" : "warn";

  const confidencePct = person.confidence != null ? Math.round(person.confidence * 100) : null;
  const confidenceColor = confidencePct == null ? "var(--faint)" : confidencePct >= 80 ? "var(--ok)" : confidencePct >= 50 ? "var(--warn)" : "var(--bad)";
  const provenanceLabel = person.provenance === "gemini" ? "Gemini" : person.provenance === "manual_attach" ? "Manual" : person.provenance ?? "—";

  return (
    <div className="person">
      {!isEditing ? (
        <>
          <div className="pn">{person.name}</div>
          <div className="pt">{person.title ?? person.headline ?? "—"}</div>
          <div className="pt">{person.location ?? "—"} · {person.currentlyAtTargetCompany ? "currently at target" : "past-only"}</div>

          {person.currentRoles.length > 0 && (
            <div className="pt">
              <strong>Current:</strong> {person.currentRoles.map((r) => `${r.title} at ${r.company}`).join(", ")}
            </div>
          )}
          {person.pastRoles.length > 0 && (
            <div className="pt faint">
              <strong>Past:</strong> {person.pastRoles.map((r) => `${r.title} at ${r.company}`).join(", ")}
            </div>
          )}

          <div className="badge-row">
            {eligibility && <span className={`tag ${eligibility.eligible ? "ok" : "bad"}`}>{eligibility.eligible ? "eligible" : "not eligible"}</span>}
            {reviewState && <span className={`tag ${decisionTag}`}>review: {latestDecision}</span>}
            {rankScore != null && <span className="tag accent">score: {rankScore} ({rankTier})</span>}
            <span className="tag">{namedMutuals.length} named mutual(s)</span>
            {vague && <span className="tag warn">vague count excluded</span>}
            {isDuplicateCandidate && <span className="tag warn">duplicate candidate</span>}
            {confidencePct != null && (
              <span className="tag" style={{ color: confidenceColor, borderColor: confidenceColor }} onClick={() => setShowConfidence(!showConfidence)}>
                {confidencePct}% confidence {person.fieldConfidence ? "⚙" : ""}
              </span>
            )}
            <span className="tag faint">{provenanceLabel}</span>
          </div>

          {eligibility && !eligibility.eligible && <div className="pmut">Reasons: {eligibility.reasons.join("; ")}</div>}
          {showConfidence && person.fieldConfidence && (
            <div className="pmut faint" style={{ fontSize: 11, lineHeight: 1.6 }}>
              <strong>Field confidence:</strong><br />
              {person.fieldConfidence.name != null && <>Name: {Math.round(person.fieldConfidence.name * 100)}% · </>}
              {person.fieldConfidence.title != null && <>Title: {Math.round(person.fieldConfidence.title * 100)}% · </>}
              {person.fieldConfidence.location != null && <>Location: {Math.round(person.fieldConfidence.location * 100)}% · </>}
              {person.fieldConfidence.currentRoles != null && <>Roles: {Math.round(person.fieldConfidence.currentRoles * 100)}% · </>}
              {person.fieldConfidence.mutualContacts != null && <>Mutuals: {Math.round(person.fieldConfidence.mutualContacts * 100)}%</>}
            </div>
          )}
          {showConfidence && !person.fieldConfidence && confidencePct != null && (
            <div className="pmut faint" style={{ fontSize: 11 }}>
              Overall confidence: {confidencePct}% (no field-level breakdown)
            </div>
          )}
          {namedMutuals.length > 0 && <div className="pmut">Named mutuals: {namedMutuals.map((m) => m.name).join(", ")}</div>}
          {sourceScreenshots.length > 0 && <div className="pmut faint">Source: {sourceScreenshots.map((s) => s.id.slice(0, 12)).join(", ")} · {provenanceLabel}</div>}
          {person.extractionAttemptId && <div className="pmut faint">Extraction attempt: {person.extractionAttemptId.slice(0, 16)}…</div>}
          {reviewState && reviewState.historyCount > 1 && <div className="pmut faint">Review history: {reviewState.historyCount} decisions</div>}

          <div className="actions">
            <button disabled={busy || latestDecision === "approved"} onClick={onApprove}>Approve</button>
            <button className="danger" disabled={busy || latestDecision === "rejected"} onClick={onReject}>Reject</button>
            <button disabled={busy || latestDecision === "needs_review"} onClick={onNeedsReview}>Needs Review</button>
            <button className="ghost" disabled={busy} onClick={onEditToggle}>Edit</button>
          </div>
        </>
      ) : (
        <EditForm
          editName={editName} setEditName={setEditName}
          editTitle={editTitle} setEditTitle={setEditTitle}
          editLocation={editLocation} setEditLocation={setEditLocation}
          editRole={editRole} setEditRole={setEditRole}
          editCompany={editCompany} setEditCompany={setEditCompany}
          editMutuals={editMutuals} setEditMutuals={setEditMutuals}
          namedMutuals={namedMutuals}
          busy={busy}
          onCancel={onEditToggle}
          onSave={() => {
            const edits: { name?: string; title?: string; location?: string; currentRoles?: { title: string; company: string }[]; mutualContactEdits?: { name: string; action: "add" }[] } = {};
            if (editName !== person.name) edits.name = editName;
            if (editTitle !== (person.title ?? "")) edits.title = editTitle || undefined;
            if (editLocation !== (person.location ?? "")) edits.location = editLocation || undefined;
            if (editRole || editCompany) edits.currentRoles = [{ title: editRole || "Unknown", company: editCompany || "Unknown" }];
            const newMutuals = editMutuals.split(",").map((m) => m.trim()).filter(Boolean);
            if (newMutuals.length > 0) edits.mutualContactEdits = newMutuals.map((name) => ({ name, action: "add" as const }));
            onEditSave(edits);
          }}
        />
      )}
    </div>
  );
}

function EditForm(props: {
  editName: string; setEditName: (v: string) => void;
  editTitle: string; setEditTitle: (v: string) => void;
  editLocation: string; setEditLocation: (v: string) => void;
  editRole: string; setEditRole: (v: string) => void;
  editCompany: string; setEditCompany: (v: string) => void;
  editMutuals: string; setEditMutuals: (v: string) => void;
  namedMutuals: ReviewQueueItem["mutuals"];
  busy: boolean;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <>
      <div style={{ fontWeight: 600, marginBottom: 8 }}>Edit person (provenance preserved)</div>
      <div className="field"><label>Name</label><input value={props.editName} onChange={(e) => props.setEditName(e.target.value)} /></div>
      <div className="field"><label>Title</label><input value={props.editTitle} onChange={(e) => props.setEditTitle(e.target.value)} /></div>
      <div className="field"><label>Location</label><input value={props.editLocation} onChange={(e) => props.setEditLocation(e.target.value)} /></div>
      <div className="field"><label>Current role title</label><input value={props.editRole} onChange={(e) => props.setEditRole(e.target.value)} /></div>
      <div className="field"><label>Current company</label><input value={props.editCompany} onChange={(e) => props.setEditCompany(e.target.value)} /></div>
      <div className="field">
        <label>Add mutual contacts (comma-separated names)</label>
        <input value={props.editMutuals} onChange={(e) => props.setEditMutuals(e.target.value)} placeholder="Jane Roe, Tom Ng" />
      </div>
      {props.namedMutuals.length > 0 && <div className="pmut faint">Existing: {props.namedMutuals.map((m) => m.name).join(", ")}</div>}
      <div className="actions">
        <button className="primary" disabled={props.busy} onClick={props.onSave}>Save edits</button>
        <button className="ghost" disabled={props.busy} onClick={props.onCancel}>Cancel</button>
      </div>
    </>
  );
}

function EmailPanel({ draft, exportReadyCount, onGenerate, loading }: {
  draft: EmailDraft | null; exportReadyCount: number; onGenerate: () => void; loading: boolean;
}) {
  return (
    <div className="card">
      <h2>Email draft</h2>
      <p className="muted" style={{ marginTop: -6, marginBottom: 12, fontSize: 12 }}>
        Uses only approved latest-state people, currently at target, with named mutuals. Plain text, max 10 people, max 7 mutuals. No screenshot/OCR/source wording.
      </p>
      {exportReadyCount === 0 && (
        <EmptyState title="No export-ready contacts" hint="Approve eligible people in the review queue first." />
      )}
      <div className="toolbar">
        <button className="primary" disabled={loading || exportReadyCount === 0} onClick={onGenerate}>Generate email draft</button>
      </div>
      {draft ? (
        <>
          <pre className="email-preview">{draft.body}</pre>
          <div className="meta faint mono" style={{ marginTop: 8, fontSize: 11 }}>draft {draft.id} · {draft.personIds.length} approved person(s){draft.rulesVersion && ` · rules v${draft.rulesVersion}`}</div>
        </>
      ) : exportReadyCount > 0 ? (
        <EmptyState title="No draft generated yet" hint="Click 'Generate email draft' above." />
      ) : null}
    </div>
  );
}

function ExportPanel({ result, exportReadyCount, onExport, loading }: {
  result: ExportResult | null; exportReadyCount: number; onExport: () => void; loading: boolean;
}) {
  return (
    <div className="card">
      <h2>Export</h2>
      <p className="muted" style={{ marginTop: -6, marginBottom: 12, fontSize: 12 }}>
        Generates CRM-ready JSON + CSV + manifest. No live CRM sync — status is 'exported', not 'synced'.
      </p>
      <div className="badge-row" style={{ marginBottom: 12 }}>
        <span className="tag accent">{exportReadyCount} export-ready</span>
      </div>
      <div className="toolbar">
        <button className="primary" disabled={loading || exportReadyCount === 0} onClick={onExport}>Generate export</button>
      </div>
      {result ? (
        <>
          <div className="list-row" style={{ marginTop: 12 }}>
            <div style={{ flex: 1 }}>
              <div>Export {result.exportId.slice(0, 20)}…</div>
              <div className="meta">{result.recordCount} record(s) · rules v{result.rulesVersion}</div>
              <div className="meta">JSON: {result.exportJson}</div>
              <div className="meta">CSV: {result.exportCsv}</div>
              <div className="meta">Manifest: {result.manifest}</div>
            </div>
            <span className="tag ok">{result.note.includes("exported") ? "exported" : "—"}</span>
          </div>
          <p className="faint" style={{ fontSize: 12, marginTop: 8 }}>{result.note}</p>
        </>
      ) : exportReadyCount > 0 ? (
        <EmptyState title="No export generated yet" hint="Click 'Generate export' above." />
      ) : (
        <EmptyState title="Export blocked" hint="Nothing approved yet. Approve eligible people first." />
      )}
    </div>
  );
}

// --- Round 4: Diagnostics Panel ---
function DiagnosticsPanel() {
  const [health, setHealth] = useState<Awaited<ReturnType<typeof api.health>> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      setErr(null);
      setHealth(await api.health());
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ margin: 0 }}>Diagnostics</h2>
        <button className="btn ghost" onClick={() => void refresh()} disabled={loading} style={{ fontSize: 12 }}>
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>
      {err ? (
        <p className="faint" style={{ color: "var(--bad)" }}>Failed to load health: {err}</p>
      ) : !health ? (
        <p className="faint">Loading diagnostics…</p>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 10, marginTop: 12 }}>
          <DiagItem label="Mode" value={`${health.deploymentMode} (${health.environment})`} />
          <DiagItem label="App version" value={health.appVersion} />
          <DiagItem label="Git commit" value={health.appCommit ?? "unknown"} />
          <DiagItem label="Rules version" value={health.rulesVersion} />
          <DiagItem label="Schema version" value={health.extractionSchemaVersion} />
          <DiagItem label="Prompt version" value={health.geminiPromptVersion} />
          <DiagItem
            label="Gemini"
            value={health.gemini.configured ? `available (${health.gemini.model})` : "pending credentials"}
            color={health.gemini.configured ? "var(--ok)" : "var(--warn)"}
          />
          <DiagItem label="Cloud deployed" value={health.deployedToCloud ? "yes" : "no"} color={health.deployedToCloud ? "var(--warn)" : "var(--ok)"} />
          <DiagItem label="DB readable" value={health.storage.db.readableOk ? "yes" : "no"} color={health.storage.db.readableOk ? "var(--ok)" : "var(--bad)"} />
          <DiagItem label="DB writable" value={health.storage.db.writable ? "yes" : "no"} color={health.storage.db.writable ? "var(--ok)" : "var(--bad)"} />
          <DiagItem label="Exports writable" value={health.storage.exports.writable ? "yes" : "no"} color={health.storage.exports.writable ? "var(--ok)" : "var(--bad)"} />
          <DiagItem label="Backups writable" value={health.storage.backups.writable ? "yes" : "no"} color={health.storage.backups.writable ? "var(--ok)" : "var(--bad)"} />
          <DiagItem label="Integrity check" value={health.lastIntegrityCheckStatus} />
          <DiagItem label="Companies" value={String(health.counts.companies)} />
          <DiagItem label="People" value={String(health.counts.extractedPeople)} />
          <DiagItem label="Export batches" value={String(health.counts.exportBatches)} />
        </div>
      )}
    </div>
  );
}

function DiagItem({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ padding: "6px 8px", background: "var(--bg)", borderRadius: 6, border: "1px solid var(--border-soft)" }}>
      <div className="faint" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 600, color: color ?? "var(--text)" }}>{value}</div>
    </div>
  );
}

// --- Round 4: Audit Panel ---
function AuditPanel({ companyId, fetchKey }: { companyId: string; fetchKey: number }) {
  const [events, setEvents] = useState<AuditEventEntry[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      setErr(null);
      const r = await api.listAuditEvents({ companyId, limit: 25 });
      setEvents(r.events);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => { void refresh(); }, [refresh, fetchKey]);

  return (
    <div className="card" style={{ marginBottom: 0 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ margin: 0 }}>Recent Audit Events</h2>
        <button className="btn ghost" onClick={() => void refresh()} disabled={loading} style={{ fontSize: 12 }}>
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>
      {err ? (
        <p className="faint" style={{ color: "var(--bad)" }}>Failed to load audit: {err}</p>
      ) : loading ? (
        <p className="faint">Loading audit events…</p>
      ) : !events || events.length === 0 ? (
        <EmptyState title="No audit events yet" hint="Actions you take (upload, review, export) will appear here." />
      ) : (
        <div style={{ marginTop: 10, maxHeight: 280, overflowY: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid var(--border-soft)" }}>
                <th style={{ padding: "4px 8px" }}>Time</th>
                <th style={{ padding: "4px 8px" }}>Event</th>
                <th style={{ padding: "4px 8px" }}>Detail</th>
              </tr>
            </thead>
            <tbody>
              {events.map((evt) => (
                <tr key={evt.id} style={{ borderBottom: "1px solid var(--border-soft)" }}>
                  <td style={{ padding: "4px 8px", whiteSpace: "nowrap" }} className="faint">
                    {new Date(evt.createdAt).toLocaleTimeString()}
                  </td>
                  <td style={{ padding: "4px 8px" }}>
                    <span className="tag accent" style={{ fontSize: 10 }}>{evt.eventType}</span>
                  </td>
                  <td style={{ padding: "4px 8px", maxWidth: 400, overflow: "hidden", textOverflow: "ellipsis" }}>
                    {evt.detail ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function BulkIntakePanel({
  loading, result, onUpload, onReset,
}: {
  loading: boolean;
  result: {
    intakeBatchId: string; screenshotsReceived: number; screenshotsAssigned: number;
    companiesCreated: number; companiesReused: number; unassignedCount: number;
    peopleExtracted: number; assignedScreenshots: { id: string; filename: string }[];
    unassignedScreenshots: { id: string; filename: string; reason: string }[];
    warnings?: string[];
  } | null;
  onUpload: (files: File[]) => Promise<void>;
  onReset: () => void;
}) {
  const [files, setFiles] = useState<File[]>([]);
  return (
    <div>
      <div className="page-head">
        <h1>Bulk Screenshot Intake</h1>
        <p>Upload multiple screenshots at once. Companies are auto-detected from role data.</p>
      </div>

      {!result && (
        <div className="card">
          <h2>Upload screenshots</h2>
          <div className="toolbar">
            <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple onChange={(e) => {
              setFiles(Array.from(e.target.files ?? []));
            }} />
            <button className="primary" disabled={loading || files.length === 0} onClick={async () => {
              if (files.length === 0) return;
              await onUpload(files);
              setFiles([]);
            }}>{loading ? "Processing…" : `Upload ${files.length > 0 ? `(${files.length} file${files.length === 1 ? "" : "s"})` : ""}`}</button>
          </div>
          {files.length > 0 && (
            <div className="list" style={{ marginTop: 12 }}>
              <div className="faint" style={{ fontSize: 12, padding: "4px 8px" }}>{files.length} file(s) selected</div>
              {files.slice(0, 10).map((f, i) => (
                <div key={i} className="list-row" style={{ fontSize: 13 }}>
                  <span>{f.name}</span>
                  <span className="faint mono">{(f.size / 1024).toFixed(0)} KB</span>
                </div>
              ))}
              {files.length > 10 && <div className="faint" style={{ padding: "4px 8px", fontSize: 12 }}>…and {files.length - 10} more</div>}
            </div>
          )}
        </div>
      )}

      {result && (
        <>
          <div className="grid four" style={{ marginTop: 12 }}>
            <div className="card" style={{ textAlign: "center" }}>
              <div className="stat">{result.screenshotsReceived}</div>
              <div className="label">Received</div>
            </div>
            <div className="card" style={{ textAlign: "center" }}>
              <div className="stat">{result.screenshotsAssigned}</div>
              <div className="label">Assigned</div>
            </div>
            <div className="card" style={{ textAlign: "center" }}>
              <div className="stat">{result.companiesCreated}</div>
              <div className="label">Companies created</div>
            </div>
            <div className="card" style={{ textAlign: "center" }}>
              <div className="stat">{result.peopleExtracted}</div>
              <div className="label">People found</div>
            </div>
          </div>

          <div className="grid two" style={{ marginTop: 12 }}>
            <div className="card">
              <h2>Assigned ({result.assignedScreenshots.length})</h2>
              {result.assignedScreenshots.length === 0 ? (
                <EmptyState title="No screenshots assigned" hint="All screenshots need company review." />
              ) : (
                <div className="list">
                  {result.assignedScreenshots.map((s) => (
                    <div key={s.id} className="list-row">
                      <span>{s.filename}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="card">
              <h2>Needs company review ({result.unassignedScreenshots.length})</h2>
              {result.unassignedScreenshots.length === 0 ? (
                <EmptyState title="All assigned" hint="Every screenshot matched a known company." />
              ) : (
                <div className="list">
                  {result.unassignedScreenshots.map((s) => (
                    <div key={s.id} className="list-row" style={{ flexDirection: "column", alignItems: "flex-start", gap: 2 }}>
                      <span>{s.filename}</span>
                      <span className="faint" style={{ fontSize: 11 }}>Reason: {s.reason}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {result.companiesReused > 0 && (
            <p className="faint" style={{ marginTop: 8, fontSize: 12 }}>{result.companiesReused} existing compan{result.companiesReused === 1 ? "y was" : "ies were"} reused.</p>
          )}
          {result.warnings && result.warnings.length > 0 && (
            <div className="card" style={{ marginTop: 12, borderColor: "var(--warn)" }}>
              <h2>Warnings</h2>
              {result.warnings.map((w, i) => <p key={i} style={{ fontSize: 13 }}>{w}</p>)}
            </div>
          )}

          <div className="toolbar" style={{ marginTop: 12 }}>
            <button onClick={onReset}>Upload more</button>
            <span className="faint" style={{ fontSize: 12 }}>Batch: <span className="mono">{result.intakeBatchId}</span></span>
          </div>
        </>
      )}
    </div>
  );
}
