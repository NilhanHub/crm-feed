// Confidence classification helpers.
// Supports field-level and person-level confidence.
// Classes: high (>=0.8), medium (>=0.5), low (<0.5), unknown (null/undefined).

export type ConfidenceClass = "high" | "medium" | "low" | "unknown";

export const CONFIDENCE_HIGH_THRESHOLD = 0.8;
export const CONFIDENCE_MEDIUM_THRESHOLD = 0.5;

export function classifyConfidence(value: number | null | undefined): ConfidenceClass {
  if (value == null || isNaN(value)) return "unknown";
  if (value >= CONFIDENCE_HIGH_THRESHOLD) return "high";
  if (value >= CONFIDENCE_MEDIUM_THRESHOLD) return "medium";
  return "low";
}

export interface FieldConfidenceInput {
  name?: number | null;
  title?: number | null;
  location?: number | null;
  currentRoles?: number | null;
  mutualContacts?: number | null;
}

export interface FieldConfidenceResult {
  name: ConfidenceClass;
  title: ConfidenceClass;
  location: ConfidenceClass;
  currentRoles: ConfidenceClass;
  mutualContacts: ConfidenceClass;
}

export function classifyFieldConfidence(fields: FieldConfidenceInput | null | undefined): FieldConfidenceResult {
  const f = fields ?? {};
  return {
    name: classifyConfidence(f.name),
    title: classifyConfidence(f.title),
    location: classifyConfidence(f.location),
    currentRoles: classifyConfidence(f.currentRoles),
    mutualContacts: classifyConfidence(f.mutualContacts),
  };
}

export function isLowConfidencePerson(personConfidence: number | null | undefined): boolean {
  return classifyConfidence(personConfidence) === "low";
}

export function hasAnyLowConfidenceField(fields: FieldConfidenceInput | null | undefined): boolean {
  const classified = classifyFieldConfidence(fields);
  return Object.values(classified).some((c) => c === "low");
}

export function confidenceLabel(cls: ConfidenceClass): string {
  switch (cls) {
    case "high": return "High confidence";
    case "medium": return "Medium confidence";
    case "low": return "Low confidence";
    case "unknown": return "Confidence unknown";
  }
}

export function confidenceColor(cls: ConfidenceClass): string {
  switch (cls) {
    case "high": return "ok";
    case "medium": return "accent";
    case "low": return "warn";
    case "unknown": return "warn";
  }
}
