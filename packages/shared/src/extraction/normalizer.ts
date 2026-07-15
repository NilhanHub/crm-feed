import type { ExtractionPayload, ExtractionPerson } from "../schema/extraction.js";
import { classifyConfidence, classifyFieldConfidence, hasAnyLowConfidenceField, type ConfidenceClass, type FieldConfidenceResult } from "./confidence.js";

// Gemini-to-reviewable normalization function.
// Accepts validated Gemini structured output and normalizes people into
// reviewable extracted-person records. Preserves raw text/provenance,
// screenshot IDs, extraction run IDs. Marks low-confidence fields.
// Never invents missing fields.

export interface NormalizedPerson {
  personId: string;
  name: string;
  headline: string | null;
  title: string | null;
  location: string | null;
  connectionDegree: 1 | 2 | 3 | "unknown";
  currentRoles: { title: string; company: string; evidenceText?: string | null }[];
  pastRoles: { title: string; company: string; evidenceText?: string | null }[];
  mutualContacts: {
    named: { name: string; headline: string | null }[];
    vagueCount: number | null;
  };
  sourceScreenshotIds: string[];
  confidence: number;
  confidenceClass: ConfidenceClass;
  fieldConfidence: FieldConfidenceResult | null;
  hasLowConfidenceField: boolean;
  provenance: "gemini" | "manual_attach" | "vision_ocr" | "document_ai";
}

export interface NormalizedExtraction {
  targetCompanyName: string;
  sourceExtractionRunId: string | null;
  people: NormalizedPerson[];
  extractionWarnings: string[];
  overallConfidence: number | null;
  provider: string;
}

export function normalizeGeminiExtraction(
  payload: ExtractionPayload,
  extractionRunId?: string
): NormalizedExtraction {
  const provider = payload.extractionMeta.provider;
  const runId = payload.sourceExtractionRunId ?? extractionRunId ?? null;

  const people = payload.people.map((person) => normalizePerson(person, provider));

  return {
    targetCompanyName: payload.targetCompanyName,
    sourceExtractionRunId: runId,
    people,
    extractionWarnings: payload.extractionMeta.extractionWarnings ?? [],
    overallConfidence: payload.extractionMeta.overallConfidence ?? null,
    provider,
  };
}

export function normalizePerson(
  person: ExtractionPerson,
  provider: "gemini" | "manual_attach" | "vision_ocr" | "document_ai"
): NormalizedPerson {
  const confidence = person.confidence;
  const confidenceClass = classifyConfidence(confidence);
  const fieldConfidenceRaw = person.fieldConfidence ?? null;
  const fieldConfidence = fieldConfidenceRaw ? classifyFieldConfidence(fieldConfidenceRaw) : null;
  const hasLowConfidenceField = fieldConfidenceRaw ? hasAnyLowConfidenceField(fieldConfidenceRaw) : false;

  return {
    personId: person.personId,
    name: person.name,
    headline: person.headline ?? null,
    title: person.title ?? null,
    location: person.location ?? null,
    connectionDegree: person.connectionDegree ?? "unknown",
    currentRoles: person.currentRoles.map((r) => ({
      title: r.title,
      company: r.company,
      evidenceText: r.evidenceText ?? null,
    })),
    pastRoles: person.pastRoles.map((r) => ({
      title: r.title,
      company: r.company,
      evidenceText: r.evidenceText ?? null,
    })),
    mutualContacts: {
      named: person.mutualContacts.named.map((m) => ({
        name: m.name,
        headline: m.headline ?? null,
      })),
      vagueCount: person.mutualContacts.vagueCount ?? null,
    },
    sourceScreenshotIds: person.sourceScreenshotIds,
    confidence,
    confidenceClass,
    fieldConfidence,
    hasLowConfidenceField,
    provenance: provider,
  };
}
