// Rules version metadata. Recorded in exports and email drafts for traceability.
// Bump when eligibility/ranking/email rules change.

export const RULES_VERSION = "4.0.0";
export const RULES_DESCRIPTION = "Round 4: production readiness — backup, audit logging, export verification, health diagnostics. All Round 1-3 business rules unchanged.";

export const EXTRACTION_SCHEMA_VERSION = "3.0.0";
export const GEMINI_PROMPT_VERSION = "1.0.0";

export function getAppVersion(): string {
  return process.env.npm_package_version ?? "0.4.0";
}
