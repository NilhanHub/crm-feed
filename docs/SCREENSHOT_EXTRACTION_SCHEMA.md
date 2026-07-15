# Screenshot Extraction Schema

Target structured JSON schema for Gemini multimodal structured output extraction and manual payload import. This is the contract that an extraction provider (Gemini, Vision OCR + parser, Document AI, or manual attach) must produce so the app can materialise `ExtractedPerson` rows for review.

## Top-level object
```jsonc
{
  "targetCompanyName": "string",
  "screenshots": [
    {
      "screenshotId": "string (matches a stored Screenshot.id)",
      "capturedAt": "string (ISO-8601) | null"
    }
  ],
  "people": [ /* see Person below */ ],
  "extractionMeta": {
    "provider": "gemini | vision_ocr | document_ai | manual_attach",
    "providerRunId": "string | null",
    "overallConfidence": "number 0..1",
    "extractionWarnings": ["string"]
  },
  "sourceExtractionRunId": "string | null"
}
```

## Person object
```jsonc
{
  "personId": "string (stable within run, e.g. slug of name)",
  "name": "string",
  "headline": "string | null",
  "title": "string | null",
  "location": "string | null",
  "connectionDegree": "1 | 2 | 3 | unknown",
  "currentRoles": [
    {
      "title": "string",
      "company": "string",
      "evidenceText": "string | null (visible text from screenshot supporting this role)"
    }
  ],
  "pastRoles": [
    {
      "title": "string",
      "company": "string",
      "evidenceText": "string | null"
    }
  ],
  "mutualContacts": {
    "named": [
      { "name": "string", "headline": "string | null" }
    ],
    "vagueCount": "number | null"
  },
  "sourceScreenshotIds": ["string"],
  "confidence": "number 0..1",
  "fieldConfidence": {
    "name": "number 0..1 | null",
    "title": "number 0..1 | null",
    "location": "number 0..1 | null",
    "currentRoles": "number 0..1 | null",
    "mutualContacts": "number 0..1 | null"
  }
}
```

## Field semantics
- `targetCompanyName`: the company the batch is about. Must match the `Company.name` (case-insensitive) the batch belongs to, else the person is not currently-at-target.
- `people[]`: every visible person card from the screenshots.
- `currentRoles`: roles the person holds **now**. A person is `currentlyAtTargetCompany` if any `currentRoles[].company` matches `targetCompanyName` (case-insensitive, trimmed). `evidenceText` captures the visible text from the screenshot that supports this role.
- `pastRoles`: prior roles. Past-only people (no current role at target) are **excluded** from email but retained for audit. `evidenceText` captures visible text.
- `mutualContacts.named[]`: only **named** mutual contacts. These are email-eligible (max 7 per person).
- `mutualContacts.vagueCount`: e.g. "2 other mutual connections". Recorded as a `MutualContact` with `excludedFromEmail = true`. **Never** appears in the email.
- `connectionDegree`: 1st/2nd/3rd as integer; `unknown` allowed.
- `sourceScreenshotIds[]`: provenance — which screenshots this person was read from. Always preserved internally, never shown in Paul's email.
- `confidence`: provider-reported confidence in this person's extraction (0..1). Manual attach = 1.0.
- `fieldConfidence`: optional field-level confidence (0..1). Fields not extracted by the provider may be `null`.
- `extractionMeta.extractionWarnings`: non-fatal warnings (e.g. "low light", "text partially obscured", "multiple people with same name").
- `sourceExtractionRunId`: links the extraction payload to the extraction run that produced it.

## Strict Gemini output shape
- Gemini must return `responseMimeType: "application/json"` with the structured output matching this schema.
- Gemini must **never guess** — only extract visible information.
- Gemini must **never decide final eligibility** — that is a deterministic code function.
- Gemini must separate current roles from past roles.
- Gemini must capture named mutual contacts only (not invent names).
- Gemini must capture vague mutual counts separately from named mutuals.
- Gemini must preserve uncertainty/confidence in `confidence` and `fieldConfidence`.

## Validation
- Implemented as Zod schemas in `packages/shared/src/schema/extraction.ts`.
- A payload that fails validation must not materialise `ExtractedPerson` rows; the extraction attempt is marked `failed` with the validation error.
- Empty `people[]` is valid (a screenshot with no people is allowed; it just yields no candidates).

## What this schema deliberately excludes from email output
- Any reference to screenshots, OCR, extraction, analysis, or "found via".
- Vague mutual counts.
- Past-only people.
- People with no named mutuals (email-ineligible by `ELIGIBILITY_RULES.md`).
- Field-level confidence (internal only, shown in review UI but never in email).
- Evidence text (internal only, shown in review UI but never in email).
