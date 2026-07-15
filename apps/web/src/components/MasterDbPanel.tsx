import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client.js";
import type { Company, MasterDbStats } from "../types.js";

interface Props {
  companies: Company[];
  fetchKey: number;
}

type Tab = "stats" | "screenshots" | "people" | "company" | "person" | "observations";

export function MasterDbPanel({ companies, fetchKey }: Props) {
  const [tab, setTab] = useState<Tab>("stats");
  const [stats, setStats] = useState<MasterDbStats | null>(null);
  const [companyId, setCompanyId] = useState("");
  const [companyPeople, setCompanyPeople] = useState<any>(null);
  const [allMasterPeople, setAllMasterPeople] = useState<any>(null);
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null);
  const [personDetail, setPersonDetail] = useState<any>(null);
  const [allShots, setAllShots] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [backfillResult, setBackfillResult] = useState<string | null>(null);

  const refreshStats = useCallback(async () => {
    try { setStats(await api.masterStats()); } catch { /* non-critical */ }
  }, []);

  useEffect(() => { void refreshStats(); }, [refreshStats, fetchKey]);

  const loadCompanyPeople = async (cid: string) => {
    if (!cid) return;
    setLoading(true);
    try {
      setCompanyPeople(await api.masterCompanyPeople(cid));
      setTab("company");
    } catch (e) { alert((e as Error).message); }
    finally { setLoading(false); }
  };

  const loadAllPeople = async () => {
    setLoading(true);
    try {
      setAllMasterPeople((await api.masterPeople()).masterPeople);
      setTab("people");
    } catch (e) { alert((e as Error).message); }
    finally { setLoading(false); }
  };

  const loadPersonDetail = async (id: string) => {
    setLoading(true);
    setSelectedPersonId(id);
    try {
      setPersonDetail(await api.masterPerson(id));
      setTab("person");
    } catch (e) { alert((e as Error).message); }
    finally { setLoading(false); }
  };

  const loadAllShots = async () => {
    setLoading(true);
    try {
      setAllShots(await api.masterScreenshots());
      setTab("screenshots");
    } catch (e) { alert((e as Error).message); }
    finally { setLoading(false); }
  };

  const handleBackfill = async () => {
    if (!window.confirm("Backfill observation records from existing extracted people? This may take a moment.")) return;
    setLoading(true);
    try {
      const r = await api.masterBackfill();
      setBackfillResult(`Backfill complete: ${r.personObservationsCreated} observations, ${r.masterPeopleCreated} master people`);
      await refreshStats();
    } catch (e) { setBackfillResult(`Backfill failed: ${(e as Error).message}`); }
    finally { setLoading(false); }
  };

  const tabs: { label: string; value: Tab }[] = [
    { label: "Stats", value: "stats" },
    { label: "Screenshots", value: "screenshots" },
    { label: "People", value: "people" },
    { label: "Observations", value: "observations" },
  ];

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>Master Database</h2>
        <div className="toolbar" style={{ gap: 6 }}>
          {tabs.map((t) => (
            <button key={t.value} className={tab === t.value ? "primary" : "ghost"} onClick={() => setTab(t.value)} style={{ fontSize: 11, padding: "4px 10px" }}>
              {t.label}
            </button>
          ))}
          <button className="ghost" onClick={handleBackfill} disabled={loading} style={{ fontSize: 11, padding: "4px 10px" }}>
            {loading ? "Working…" : "Backfill"}
          </button>
        </div>
      </div>

      {backfillResult && (
        <div style={{ padding: "8px 12px", marginBottom: 12, background: "var(--bg)", borderRadius: 6, fontSize: 13, border: "1px solid var(--border-soft)" }}>
          {backfillResult}
        </div>
      )}

      {tab === "stats" && stats && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 8 }}>
          <StatItem label="Screenshots stored" value={stats.screenshotsStored} />
          <StatItem label="Extraction runs" value={stats.extractionRuns} />
          <StatItem label="Companies" value={stats.companies} />
          <StatItem label="Person observations" value={stats.personObservations} />
          <StatItem label="Master people" value={stats.masterPeople} />
          <StatItem label="Employment obs" value={stats.employmentObservations} />
          <StatItem label="Named mutuals" value={stats.namedMutualObservations} />
          <StatItem label="Vague mutuals" value={stats.vagueMutualObservations} />
          <StatItem label="Unassigned shots" value={stats.unassignedScreenshots} warn={stats.unassignedScreenshots > 0} />
        </div>
      )}

      {tab === "stats" && !stats && (
        <div className="faint" style={{ fontSize: 13 }}>Loading stats…</div>
      )}

      {tab === "screenshots" && (
        <div>
          <div className="toolbar" style={{ marginBottom: 8 }}>
            <button className="ghost" onClick={loadAllShots} disabled={loading} style={{ fontSize: 11 }}>
              {loading ? "Loading…" : "Refresh"}
            </button>
            <span className="faint" style={{ fontSize: 11 }}>Total screenshots in DB</span>
          </div>
          {allShots === null ? (
            <button className="primary" onClick={loadAllShots}>Load screenshots</button>
          ) : (
            <div className="list" style={{ maxHeight: 300, overflowY: "auto" }}>
              {(allShots as any[]).map((s: any) => (
                <div key={s.id} className="list-row" style={{ fontSize: 12 }}>
                  <div style={{ flex: 1 }}>
                    <div>{s.originalFilename}</div>
                    <div className="meta">{s.id.slice(0, 16)}… · {Math.round(s.sizeBytes / 1024)}KB · sha {s.sha256.slice(0, 10)}</div>
                  </div>
                  <span className={`tag ${s.assignmentState === "assigned" ? "ok" : s.assignmentState === "needs_company_review" ? "warn" : "faint"}`} style={{ fontSize: 10 }}>
                    {s.assignmentState ?? "unknown"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "people" && (
        <div>
          <div className="toolbar" style={{ marginBottom: 8 }}>
            <button className="ghost" onClick={loadAllPeople} disabled={loading} style={{ fontSize: 11 }}>
              {loading ? "Loading…" : "Refresh"}
            </button>
          </div>
          {allMasterPeople === null ? (
            <button className="primary" onClick={loadAllPeople}>Load master people</button>
          ) : (
            <div className="list" style={{ maxHeight: 400, overflowY: "auto" }}>
              {(allMasterPeople as any[]).map(({ masterPerson, observations, employmentObservations: eobs, mutualConnectionObservations: mobs }: any) => (
                <div
                  key={masterPerson.id}
                  className="list-row"
                  style={{ cursor: "pointer", borderColor: selectedPersonId === masterPerson.id ? "var(--accent)" : undefined, fontSize: 12 }}
                  onClick={() => loadPersonDetail(masterPerson.id)}
                >
                  <div style={{ flex: 1 }}>
                    <div><strong>{masterPerson.displayName}</strong> <span className="faint">({masterPerson.mergeStatus})</span></div>
                    <div className="meta">{observations.length} observations · {eobs.length} employments · {mobs.length} mutuals</div>
                    {masterPerson.aliases.length > 1 && <div className="meta faint">Aliases: {masterPerson.aliases.join(", ")}</div>}
                  </div>
                  <span className={`tag ${masterPerson.mergeStatus === "merged" ? "accent" : "ok"}`} style={{ fontSize: 10 }}>
                    {masterPerson.mergeStatus}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "person" && personDetail && (
        <div>
          <button className="ghost" onClick={() => { setTab("people"); setSelectedPersonId(null); setPersonDetail(null); }} style={{ fontSize: 11, marginBottom: 8 }}>
            ← Back to people
          </button>
          <div style={{ padding: "8px 0" }}>
            <h3 style={{ margin: "0 0 4px 0" }}>{personDetail.masterPerson.displayName}</h3>
            <div className="meta">ID: {personDetail.masterPerson.id} · Merge: {personDetail.masterPerson.mergeStatus}</div>
            {personDetail.masterPerson.aliases.length > 1 && (
              <div className="meta faint">Aliases: {personDetail.masterPerson.aliases.join(", ")}</div>
            )}
            <p className="faint" style={{ fontSize: 11, fontStyle: "italic" }}>{personDetail.identityNote}</p>
          </div>

          <div className="divider" />
          <div><strong>Observations ({personDetail.observations.length})</strong></div>
          {personDetail.observations.length === 0 ? (
            <div className="faint" style={{ fontSize: 12, padding: "8px 0" }}>No observations</div>
          ) : (
            <div className="list" style={{ maxHeight: 250, overflowY: "auto", marginTop: 6 }}>
              {(personDetail.observations as any[]).map((o: any) => (
                <div key={o.id} className="list-row" style={{ fontSize: 12 }}>
                  <div style={{ flex: 1 }}>
                    <div>{o.observedName} {o.currentCompanyName && <span className="faint">→ {o.currentCompanyName}</span>}</div>
                    <div className="meta">Confidence: {Math.round(o.confidence * 100)}% · Shot: {o.sourceScreenshotId.slice(0, 12)}… · Run: {o.extractionRunId.slice(0, 12)}…</div>
                    {o.currentRoleText && <div className="meta">{o.currentRoleText}</div>}
                    {o.evidenceText && <div className="meta faint">{o.evidenceText}</div>}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="divider" />
          <div><strong>Employment ({personDetail.employmentObservations.length})</strong></div>
          {personDetail.employmentObservations.length > 0 && (
            <div className="list" style={{ maxHeight: 150, overflowY: "auto", marginTop: 6 }}>
              {(personDetail.employmentObservations as any[]).map((eo: any) => (
                <div key={eo.id} className="list-row" style={{ fontSize: 12 }}>
                  <div style={{ flex: 1 }}>
                    <div>{eo.roleTitle} <span className="faint">at {eo.companyNameObserved}</span></div>
                    <div className="meta">
                      <span className={`tag ${eo.status === "current" ? "ok" : eo.status === "past" ? "bad" : "faint"}`} style={{ fontSize: 9, padding: "1px 4px" }}>{eo.status}</span>
                      <span> · Confidence: {Math.round(eo.confidence * 100)}%</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="divider" />
          <div><strong>Mutual Connections ({personDetail.mutualConnectionObservations.length})</strong></div>
          <div className="list" style={{ maxHeight: 150, overflowY: "auto", marginTop: 6 }}>
            {personDetail.mutualConnectionObservations.length === 0 ? (
              <div className="faint" style={{ fontSize: 12, padding: "8px 0" }}>No mutual connections</div>
            ) : (
              (personDetail.mutualConnectionObservations as any[]).map((mo: any) => (
                <div key={mo.id} className="list-row" style={{ fontSize: 12 }}>
                  <div style={{ flex: 1 }}>
                    {mo.type === "named" ? (
                      <div>
                        <span className="tag ok" style={{ fontSize: 9, padding: "1px 4px", marginRight: 4 }}>named</span>
                        {mo.mutualName}
                      </div>
                    ) : (
                      <div>
                        <span className="tag warn" style={{ fontSize: 9, padding: "1px 4px", marginRight: 4 }}>vague</span>
                        {mo.vagueMutualCount} mutual(s) (count only — excluded from email)
                      </div>
                    )}
                  </div>
                  <span className="meta faint" style={{ fontSize: 10 }}>{mo.sourceScreenshotId.slice(0, 12)}…</span>
                </div>
              ))
            )}
          </div>

          <div className="divider" />
          <div><strong>Source Screenshots ({personDetail.sourceScreenshots.length})</strong></div>
          {(personDetail.sourceScreenshots as any[]).map((ss: any) => (
            <div key={ss.id} style={{ fontSize: 12, padding: "4px 0" }}>
              {ss.originalFilename} <span className="faint">· sha {ss.sha256.slice(0, 10)}</span>
            </div>
          ))}
        </div>
      )}

      {tab === "observations" && (
        <div>
          <div className="toolbar" style={{ marginBottom: 8 }}>
            <select value={companyId} onChange={(e) => setCompanyId(e.target.value)} style={{ fontSize: 12 }}>
              <option value="">Select company to browse</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <button className="primary" disabled={!companyId || loading} onClick={() => loadCompanyPeople(companyId)} style={{ fontSize: 11 }}>
              {loading ? "Loading…" : "Browse"}
            </button>
          </div>

          {companyPeople && (
            <div>
              <p className="faint" style={{ fontSize: 12, marginBottom: 8 }}>
                {companyPeople.company.name} — {companyPeople.totalCount} person(s)
              </p>
              <div className="list" style={{ maxHeight: 500, overflowY: "auto" }}>
                {(companyPeople.people as any[]).map(({ extractedPerson, observations, employmentObservations: eobs, mutualConnectionObservations: mobs, sourceScreenshots }: any) => (
                  <div key={extractedPerson.id} style={{ padding: "8px 0", borderBottom: "1px solid var(--border-soft)" }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{extractedPerson.name}</div>
                    <div className="meta" style={{ fontSize: 11 }}>
                      {extractedPerson.title ?? "—"} · {extractedPerson.currentlyAtTargetCompany ? "at target" : "past-only"}
                      · Confidence: {Math.round(extractedPerson.confidence * 100)}%
                    </div>
                    {observations.length > 0 && (
                      <div className="meta faint" style={{ fontSize: 11, marginTop: 4 }}>
                        {observations.length} observation(s) · Source shots: {(sourceScreenshots as any[]).map((s: any) => s.originalFilename).join(", ")}
                      </div>
                    )}
                    {(eobs as any[]).filter((e: any) => e.status === "current").length > 0 && (
                      <div className="meta" style={{ fontSize: 11, marginTop: 2 }}>
                        <span className="tag ok" style={{ fontSize: 9, padding: "1px 4px", marginRight: 4 }}>current</span>
                        {(eobs as any[]).filter((e: any) => e.status === "current").map((e: any) => `${e.roleTitle} at ${e.companyNameObserved}`).join(", ")}
                      </div>
                    )}
                    {(mobs as any[]).filter((m: any) => m.type === "named").length > 0 && (
                      <div className="meta" style={{ fontSize: 11, marginTop: 2 }}>
                        <span className="tag ok" style={{ fontSize: 9, padding: "1px 4px", marginRight: 4 }}>mutuals</span>
                        {(mobs as any[]).filter((m: any) => m.type === "named").map((m: any) => m.mutualName).filter(Boolean).join(", ")}
                      </div>
                    )}
                    {(mobs as any[]).filter((m: any) => m.type === "vague_count").length > 0 && (
                      <div className="meta faint" style={{ fontSize: 11, marginTop: 2 }}>
                        Vague mutual count(s) — excluded from email
                      </div>
                    )}
                    {extractedPerson.id && (
                      <div className="meta faint" style={{ fontSize: 10, marginTop: 2 }}>
                        ID: {extractedPerson.id.slice(0, 16)}…
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StatItem({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div style={{ textAlign: "center", padding: "8px 4px", background: "var(--bg)", borderRadius: 8, border: `1px solid ${warn ? "var(--warn)" : "var(--border-soft)"}` }}>
      <div style={{ fontSize: 20, fontWeight: 700, color: warn ? "var(--warn)" : "var(--text)" }}>{value}</div>
      <div className="faint" style={{ fontSize: 11 }}>{label}</div>
    </div>
  );
}
