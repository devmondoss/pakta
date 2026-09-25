import type { Exception } from "@pakta/canonical-model";
import { describe, expect, it, vi } from "vitest";
import { notifyExceptions } from "../src/notifyExceptions.js";

function exception(payableId: string): Exception {
  return {
    payableId,
    status: "BLOCKED",
    reason: "MISSING_RECEIPT",
    message: "No confirmed receipt on file.",
    severity: "MEDIUM",
    ownerRole: "OPERATIONS",
    requiredAction: "CONFIRM_RECEIPT",
    autoRevalidate: true,
    policyVersion: "FIN-4.2",
  };
}

describe("notifyExceptions", () => {
  it("keeps notifying the rest of the batch after one delivery fails", async () => {
    const notifier = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("webhook timed out"))
      .mockResolvedValueOnce(undefined);

    const results = await notifyExceptions(
      [exception("PAY-001"), exception("PAY-002"), exception("PAY-003")],
      notifier,
    );

    expect(notifier).toHaveBeenCalledTimes(3);
    expect(results).toEqual([
      { status: "SENT", payableId: "PAY-001" },
      { status: "FAILED", payableId: "PAY-002", error: "webhook timed out" },
      { status: "SENT", payableId: "PAY-003" },
    ]);
  });
});
