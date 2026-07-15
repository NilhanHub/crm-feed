# Agent Workflow (Future — Not Implemented Yet)

This document defines the **future** Google ADK (Agent Development Kit) agent topology for CRM Feed. **No agents are implemented in Round 1.** ADK is orchestration only; the **database remains the single source of truth**, never agent memory.

Reference (for later): https://docs.cloud.google.com/gemini-enterprise-agent-platform/build/adk

## Principle
Agents coordinate steps and call tools that read/write the database. Agents do **not** hold the source of truth in their own state. Every state change is persisted to the CRM Feed store and can be replayed from the database alone.

## Proposed agents (future)

### 1. Screenshot Intake Agent
- Receives uploaded screenshots, validates file type/size, computes sha256, persists the `Screenshot` record and file under `data/uploads`.
- Creates/updates the `ScreenshotBatch`.
- Does not extract anything.

### 2. Extraction Agent
- Creates an `ExtractionRun` for a batch.
- Calls a real provider (Gemini multimodal structured output, Vision OCR, or Document AI) under the `nilhan.dev@gmail.com` identity lock.
- Validates the returned payload against the Zod schema in `packages/shared`.
- On success, materialises `ExtractedPerson` + `MutualContact` rows and sets the run to `review_ready`.
- On missing credentials, sets the run to `pending_credentials` with a clear error. **Never invents people.**

Reference (for later): https://ai.google.dev/gemini-api/docs/structured-output

### 3. Validation Agent
- Runs the deterministic eligibility engine (`packages/shared/src/rules/eligibility.ts`) to produce `EligibilityDecision` rows.
- Runs the deterministic ranking function to order people.
- No LLM judgement here — pure code.

### 4. Ranking Agent
- Applies role prioritisation and caps (max 7 named mutuals, max 10 people).
- Produces the ordered shortlist for review.

### 5. CRM Sync Agent
- Reads only `approved` `ReviewDecision` rows.
- Performs idempotent writes per `CRM_WRITE_POLICY.md`.
- With no live CRM API, performs the real export contract (JSON/CSV under `data/exports`) and marks records `exported` — never `synced` without a real API call.

### 6. Email Draft Agent
- Calls the deterministic email formatter in `packages/shared` using only approved, currently-at-target, named-mutual people.
- Produces a plain-text `EmailDraft` with no screenshot/OCR/source wording.
- Does not send email (draft only).

## Source of truth invariant
- If all agents were removed, the database must still fully describe the current state of every company, batch, screenshot, run, person, decision, sync record, and email draft.
- Agents are replaceable; the database is not.
