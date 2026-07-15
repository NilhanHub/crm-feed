# ADK Orchestration Boundary

This document defines the boundary between the CRM Feed system and any future ADK (Agent Development Kit) orchestration. No ADK agent exists in this project today.

---

## ADK is FUTURE orchestration only

**No ADK agent is built in this project.** ADK is referenced only as a *future* orchestration layer. Any ADK work is out of scope for the current build and must respect the boundaries below.

---

## The CRM database remains the single source of truth

The CRM Feed local JSON collections (`data/db/`) are the **single source of truth**. They own canonical CRM data. Nothing — including any future ADK agent — supersedes them.

---

## ADK must NOT store canonical CRM data

ADK **orchestrates; it does not own data.** An ADK agent may read, schedule, and trigger, but it must **not** persist a separate copy of canonical CRM data. If ADK needs data, it reads it through the CRM Feed API at call time. ADK is never a data store.

---

## Possible future ADK jobs

If/when ADK is introduced, candidate orchestration jobs (none built yet) include:

- **Schedule batch Gemini extraction** — kick off extraction runs on a schedule.
- **Summarize extraction failures** — aggregate failed extractions into a human-readable digest.
- **Notify a human reviewer** when the review queue has pending items.
- **Trigger backup checks** on a schedule (e.g. verify the most recent backup daily).
- **Monitor the health endpoint** and alert on degraded status.

All of these are *orchestration* concerns — they decide *when* and *whether* to call existing CRM Feed capabilities. None of them change what the CRM Feed API does.

---

## Exact data boundaries

These boundaries are non-negotiable for any future ADK work:

- **ADK reads from the CRM Feed API only** — never directly from the DB files in `data/db/`.
- **ADK writes back via API endpoints only** — never directly to the DB files.
- **ADK never holds secrets** — the `GEMINI_API_KEY` (and any other credentials) stay in the CRM Feed API's environment. ADK does not receive, store, or log them.

In short: ADK is a client of the CRM Feed API, nothing more.

---

## Exact risks

If these boundaries are violated, the following risks materialize:

- **Bypassing review gates** — if an ADK agent calls export directly (skipping the review/approval gates), unapproved data could be exported. ADK must never call export endpoints except as a result of an approved human workflow.
- **Runaway extraction costs** — if an ADK agent schedules extraction without bounds, Gemini API costs can spiral. Any future scheduling must include hard limits.
- **Data leakage** — if an ADK agent logs entity details (names, emails, company data) to its own logs, sensitive data leaks outside the CRM Feed boundary. ADK must log metadata and IDs, not entity contents.

---

## Credentials and resources required before ADK implementation

None of these exist for ADK yet. Before any ADK work begins, the following must be in place:

- **`GEMINI_API_KEY`** — under the `nilhan.dev@gmail.com` account.
- **Deployed CRM Feed API** — with authentication enabled, so ADK can call it as a client.
- **ADK service account** — a dedicated identity for the ADK agent.
- **Monitoring/logging infrastructure** — so ADK actions are observable and auditable.

---

## Identity lock

All resources — Google, Firebase, GCP, the Gemini API key, the ADK service account, and any monitoring/logging — must be under **`nilhan.dev@gmail.com`** only. No other identity is permitted.
