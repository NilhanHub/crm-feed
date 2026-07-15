# Round 3 — Gemini Extraction Plan

## Goal
Wire Google Gemini multimodal structured JSON extraction into CRM Feed, replacing the manual payload attach step with real AI extraction from uploaded screenshots.

## Identity Lock
All Google Cloud, Gemini, and Vertex AI resources must be owned, created, billed, and configured **only** through **nilhan.dev@gmail.com**. No other Google identity. See `IDENTITY_LOCK.md`.

## Integration Plan
1. Create a GCP project under `nilhan.dev@gmail.com` (not in this round — Round 3 execution).
2. Enable the Gemini API (Generative Language API) or Vertex AI API.
3. Set up authentication via Application Default Credentials (ADC) or a Gemini API key stored in `.env` (gitignored).
4. Implement an extraction provider in `apps/api/src/extraction/gemini.ts` that:
   - Reads screenshot files from `data/uploads`.
   - Sends them to Gemini with a structured output prompt.
   - Receives structured JSON matching `SCREENSHOT_EXTRACTION_SCHEMA.md`.
   - Validates the response with the Zod schema (`safeParseExtractionPayload`).
   - On validation failure, sets the `ExtractionRun` status to `failed` with a clear error.
   - On success, materialises `ExtractedPerson` + `MutualContact` + `EligibilityDecision` rows (same as manual attach).

## Required Environment Variables
```
GEMINI_API_KEY=...          # OR
GOOGLE_APPLICATION_CREDENTIALS=path/to/service-account.json
GEMINI_MODEL=gemini-2.0-flash  # or gemini-1.5-pro for higher quality
GCP_PROJECT_ID=...          # if using Vertex AI
```

## Credential Failure Behavior
- If `GEMINI_API_KEY` is not set AND `GOOGLE_APPLICATION_CREDENTIALS` is not set:
  - The extraction run status is set to `pending_credentials`.
  - A clear error message is stored: "No Gemini credentials configured. Set GEMINI_API_KEY or GOOGLE_APPLICATION_CREDENTIALS."
  - **No fake extraction is performed.** The app does not invent people.
  - The manual payload attach endpoint remains available as a fallback.
- If credentials are set but the API call fails:
  - The extraction run status is set to `failed`.
  - The full error message is stored on the run.
  - The user can retry or attach a payload manually.

## Structured Output Schema
- Use the schema defined in `docs/SCREENSHOT_EXTRACTION_SCHEMA.md`.
- Implemented as Zod in `packages/shared/src/schema/extraction.ts`.
- Gemini's `responseMimeType: "application/json"` with `responseSchema` for structured output.
- Reference: https://ai.google.dev/gemini-api/docs/structured-output

## Validation Path
1. Gemini returns JSON.
2. `safeParseExtractionPayload()` validates against Zod schema.
3. If valid: materialise people + mutuals + eligibility (same as manual attach).
4. If invalid: set run to `failed` with validation error.

## Confidence Scoring
- Gemini's `extractionMeta.overallConfidence` is stored on the run.
- Per-person `confidence` (0..1) is stored on each `ExtractedPerson`.
- Confidence is used in deduplication (higher confidence wins) and ranking tie-breaking.

## Screenshot Provenance
- Each extracted person stores `sourceScreenshotIds[]` linking back to the original screenshots.
- Provenance is preserved in export manifests and CrmSyncRecords.
- Provenance is **never** exposed in Paul-facing email drafts.

## No Fake Extraction Rule
- If Gemini is unavailable, credentials are missing, or the API call fails, the app **must not** invent people.
- The extraction run stays `pending_credentials` or `failed`.
- The manual payload attach endpoint remains as a fallback.

## Optional Vision/Document AI Backup (later)
- Google Cloud Vision OCR: https://docs.cloud.google.com/vision/docs/ocr
- Document AI Enterprise Document OCR: https://docs.cloud.google.com/document-ai/docs/enterprise-document-ocr
- These can be used as a backup if Gemini structured output is insufficient for certain screenshots.
- Not required for Round 3 — Gemini multimodal should be sufficient for LinkedIn screenshot extraction.
