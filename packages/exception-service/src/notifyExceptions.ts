import type { Exception } from "@pakta/canonical-model";
import type { ExceptionNotifier } from "./notifier.js";

export type NotificationResult =
  | { status: "SENT"; payableId: string }
  | { status: "FAILED"; payableId: string; error: string };

/**
 * One failed delivery must never block the rest of the batch — same
 * "reject individually" posture as `ingestWorkbook` for malformed rows.
 * An owner whose webhook is down for a minute shouldn't silence every
 * other exception in the run.
 */
export async function notifyExceptions(
  exceptions: Exception[],
  notifier: ExceptionNotifier,
): Promise<NotificationResult[]> {
  const results: NotificationResult[] = [];

  for (const exception of exceptions) {
    try {
      await notifier(exception);
      results.push({ status: "SENT", payableId: exception.payableId });
    } catch (err) {
      results.push({
        status: "FAILED",
        payableId: exception.payableId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return results;
}
