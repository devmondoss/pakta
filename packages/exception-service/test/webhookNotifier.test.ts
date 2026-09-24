import type { Exception } from "@pakta/canonical-model";
import { describe, expect, it, vi } from "vitest";
import { createWebhookNotifier } from "../src/webhookNotifier.js";

const exception: Exception = {
  payableId: "PAY-INV-004",
  status: "BLOCKED",
  reason: "VENDOR_WALLET_CHANGED",
  message: "Invoice wallet differs from the attested wallet.",
  severity: "CRITICAL",
  ownerRole: "VENDOR_MASTER",
  requiredAction: "REVERIFY_VENDOR_WALLET",
  autoRevalidate: true,
  policyVersion: "FIN-4.2",
};

describe("createWebhookNotifier", () => {
  it("POSTs the exception to the owner's configured webhook", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const notify = createWebhookNotifier(
      { VENDOR_MASTER: "https://hooks.example.com/vendor-master" },
      { fetchImpl },
    );

    await notify(exception);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://hooks.example.com/vendor-master");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({
      payable_id: "PAY-INV-004",
      reason_code: "VENDOR_WALLET_CHANGED",
      owner_role: "VENDOR_MASTER",
      required_action: "REVERIFY_VENDOR_WALLET",
      message: "Invoice wallet differs from the attested wallet.",
      severity: "CRITICAL",
    });
  });

  it("falls back to defaultUrl when the owner has no dedicated route", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const notify = createWebhookNotifier({}, { defaultUrl: "https://hooks.example.com/catch-all", fetchImpl });

    await notify(exception);

    expect(fetchImpl.mock.calls[0]![0]).toBe("https://hooks.example.com/catch-all");
  });

  it("throws when neither a route nor a default url exist", async () => {
    const notify = createWebhookNotifier({});
    await expect(notify(exception)).rejects.toThrow(/no webhook route/);
  });

  it("throws when the webhook responds with a non-2xx status", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    const notify = createWebhookNotifier({ VENDOR_MASTER: "https://hooks.example.com/vendor-master" }, { fetchImpl });

    await expect(notify(exception)).rejects.toThrow(/responded with 500/);
  });
});
