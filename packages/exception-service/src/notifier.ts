import type { Exception } from "@pakta/canonical-model";

/**
 * What actually goes over the wire — deliberately narrower than the full
 * `Exception` object (no internal `evidence`/`autoRevalidate` plumbing),
 * matching the interoperable shape from `Pakta_Documento_Maestro.md` §10.
 */
export type NotificationPayload = {
  payable_id: string;
  reason_code: string;
  owner_role: string;
  required_action: string;
  message: string;
  severity: string;
};

export function toNotificationPayload(exception: Exception): NotificationPayload {
  return {
    payable_id: exception.payableId,
    reason_code: exception.reason,
    owner_role: exception.ownerRole,
    required_action: exception.requiredAction,
    message: exception.message,
    severity: exception.severity,
  };
}

/** Provider boundary, same pattern as `InvoiceExtractor` — webhook today, email or Slack later, all interchangeable. */
export type ExceptionNotifier = (exception: Exception) => Promise<void>;
