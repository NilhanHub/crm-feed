// Append-only audit event writer. Used by critical backend paths to record
// what happened, by whom, and which entities were involved. Audit events never
// contain secrets and never approve/export anything by themselves.
import { auditEvents } from "../store/db.js";
import { newId, nowIso } from "../util/id.js";
import type { AuditEvent, AuditEventType } from "@crm-feed/shared";

export interface AuditInput {
  eventType: AuditEventType;
  companyId?: string;
  batchId?: string;
  personId?: string;
  screenshotId?: string;
  attemptId?: string;
  exportId?: string;
  emailDraftId?: string;
  backupId?: string;
  actor?: string;
  detail?: string;
}

/** Write an audit event. Returns the persisted event. Never throws to the caller. */
export async function writeAudit(input: AuditInput): Promise<AuditEvent> {
  const event: AuditEvent = {
    id: newId("aud"),
    eventType: input.eventType,
    companyId: input.companyId,
    batchId: input.batchId,
    personId: input.personId,
    screenshotId: input.screenshotId,
    attemptId: input.attemptId,
    exportId: input.exportId,
    emailDraftId: input.emailDraftId,
    backupId: input.backupId,
    actor: input.actor ?? "system",
    detail: input.detail,
    createdAt: nowIso(),
  };
  await auditEvents.set(event);
  return event;
}
