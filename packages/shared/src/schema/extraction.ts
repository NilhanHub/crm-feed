import { z } from "zod";

// Zod schema for the structured extraction payload contract.
// See docs/SCREENSHOT_EXTRACTION_SCHEMA.md.
// Used by both Gemini extraction and manual payload import.

// --- Role with optional evidence text ---
export const RoleEntrySchema = z.object({
  title: z.string().min(1),
  company: z.string().min(1),
  evidenceText: z.string().optional(),
});

export const NamedMutualSchema = z.object({
  name: z.string().min(1),
  headline: z.string().optional().nullable(),
});

export const ConnectionDegreeSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal("unknown"),
]);

// --- Field-level confidence ---
export const FieldConfidenceSchema = z.object({
  name: z.number().min(0).max(1).optional().nullable(),
  title: z.number().min(0).max(1).optional().nullable(),
  location: z.number().min(0).max(1).optional().nullable(),
  currentRoles: z.number().min(0).max(1).optional().nullable(),
  mutualContacts: z.number().min(0).max(1).optional().nullable(),
}).optional().nullable();

export const PersonSchema = z.object({
  personId: z.string().min(1),
  name: z.string().min(1),
  headline: z.string().optional().nullable(),
  title: z.string().optional().nullable(),
  location: z.string().optional().nullable(),
  connectionDegree: ConnectionDegreeSchema.optional(),
  currentRoles: z.array(RoleEntrySchema).default([]),
  pastRoles: z.array(RoleEntrySchema).default([]),
  mutualContacts: z.object({
    named: z.array(NamedMutualSchema).default([]),
    vagueCount: z.number().int().nonnegative().optional().nullable(),
  }),
  sourceScreenshotIds: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1).default(1),
  fieldConfidence: FieldConfidenceSchema,
});

export const ScreenshotRefSchema = z.object({
  screenshotId: z.string().min(1),
  capturedAt: z.string().optional().nullable(),
});

export const ExtractionMetaSchema = z.object({
  provider: z.enum(["gemini", "vision_ocr", "document_ai", "manual_attach"]),
  providerRunId: z.string().optional().nullable(),
  overallConfidence: z.number().min(0).max(1).optional(),
  extractionWarnings: z.array(z.string()).optional().default([]),
});

export const CompanyCandidateSchema = z.object({
  name: z.string().min(1),
  signalType: z.enum(["current_role", "past_role", "profile_mention", "ad_sidebar", "search_hint", "other"]),
  mentionCount: z.number().int().nonnegative(),
  evidenceText: z.string().optional(),
});

export const ScreenshotCompanyInferenceSchema = z.object({
  targetCompanyCandidates: z.array(CompanyCandidateSchema).default([]),
  dominantCurrentCompanyName: z.string().optional().nullable(),
  dominantCurrentCompanyConfidence: z.number().min(0).max(1).optional().nullable(),
  isMixedCompanyScreenshot: z.boolean().optional().default(false),
  needsCompanyReview: z.boolean().optional().default(true),
  reasoningShort: z.string().optional(),
});

export const ExtractionPayloadSchema = z.object({
  targetCompanyName: z.string().min(1),
  screenshots: z.array(ScreenshotRefSchema).default([]),
  people: z.array(PersonSchema).default([]),
  extractionMeta: ExtractionMetaSchema,
  sourceExtractionRunId: z.string().optional().nullable(),
  screenshotCompanyInference: ScreenshotCompanyInferenceSchema.optional(),
});

export type ExtractionPayload = z.infer<typeof ExtractionPayloadSchema>;
export type ScreenshotCompanyInference = z.infer<typeof ScreenshotCompanyInferenceSchema>;
export type CompanyCandidateType = z.infer<typeof CompanyCandidateSchema>;
export type ExtractionPerson = z.infer<typeof PersonSchema>;
export type ExtractionNamedMutual = z.infer<typeof NamedMutualSchema>;
export type FieldConfidence = z.infer<typeof FieldConfidenceSchema>;

export function parseExtractionPayload(input: unknown): ExtractionPayload {
  return ExtractionPayloadSchema.parse(input);
}

export function safeParseExtractionPayload(input: unknown):
  | { ok: true; data: ExtractionPayload }
  | { ok: false; error: string } {
  const result = ExtractionPayloadSchema.safeParse(input);
  if (result.success) {
    return { ok: true, data: result.data };
  }
  return { ok: false, error: result.error.toString() };
}

// --- Gemini-specific structured output schema ---
// This is a stricter subset for validating Gemini responses specifically.
// Gemini must return provider: "gemini" and confidence fields.
export const GeminiExtractionPayloadSchema = ExtractionPayloadSchema.extend({
  extractionMeta: ExtractionMetaSchema.extend({
    provider: z.literal("gemini"),
  }),
});

export type GeminiExtractionPayload = z.infer<typeof GeminiExtractionPayloadSchema>;

export function safeParseGeminiExtraction(input: unknown):
  | { ok: true; data: GeminiExtractionPayload }
  | { ok: false; error: string } {
  const result = GeminiExtractionPayloadSchema.safeParse(input);
  if (result.success) {
    return { ok: true, data: result.data };
  }
  return { ok: false, error: result.error.toString() };
}
