import type { Approval, PurchaseOrder, Receipt, Vendor, VendorWallet } from "@pakta/canonical-model";
import { evaluatePayable } from "@pakta/rules-kernel";
import { describe, expect, it } from "vitest";
import { resolveExtraction, type KnownSources } from "../src/resolveExtraction.js";
import type { InvoiceExtraction } from "../src/schema.js";

const vendor: Vendor = { vendorId: "VEN-001", legalName: "CloudData Inc.", verificationStatus: "VERIFIED" };
const vendorWallet: VendorWallet = {
  vendorId: "VEN-001",
  address: "GA1CD9F3KXQPLMN7R2WZT8VY",
  attestationStatus: "ATTESTED",
  version: 1,
  createdAt: new Date("2026-01-10"),
};
const po: PurchaseOrder = { poId: "PO-72881", vendorId: "VEN-001", amount: "5000.00", status: "OPEN" };
const receipt: Receipt = {
  poId: "PO-72881",
  confirmedQty: 1,
  invoicedQty: 1,
  confirmedBy: "ops@pakta.demo",
  confirmedAt: new Date("2026-09-20"),
};
const approvals: Approval[] = [];

const sources: KnownSources = {
  vendors: [vendor],
  vendorWallets: [vendorWallet],
  purchaseOrders: [po],
  receipts: [receipt],
  approvals,
};

function goodExtraction(overrides: Partial<InvoiceExtraction> = {}): InvoiceExtraction {
  return {
    vendorName: { value: "CloudData Inc.", confidence: 0.95, sourceExcerpt: "Bill to: CloudData Inc." },
    invoiceId: { value: "INV-001", confidence: 0.97, sourceExcerpt: "Invoice #INV-001" },
    amount: { value: "5000.00", confidence: 0.96, sourceExcerpt: "Total: $5,000.00" },
    dueDate: { value: "2026-09-23", confidence: 0.9, sourceExcerpt: "Due 09/23/2026" },
    poReference: { value: "PO-72881", confidence: 0.94, sourceExcerpt: "PO PO-72881" },
    walletAddress: { value: "GA1CD9F3KXQPLMN7R2WZT8VY", confidence: 0.92, sourceExcerpt: "Pay to GA1CD..." },
    ...overrides,
  };
}

describe("resolveExtraction", () => {
  it("resolves a clean extraction into a candidate payable", () => {
    const result = resolveExtraction(goodExtraction(), sources, { policyVersion: "FIN-4.2" });
    expect(result.status).toBe("CANDIDATE");
    if (result.status === "CANDIDATE") {
      expect(result.payable.vendor.vendorId).toBe("VEN-001");
      expect(result.payable.purchaseOrder?.poId).toBe("PO-72881");
    }
  });

  it("sends a low-confidence field to review instead of guessing", () => {
    const result = resolveExtraction(
      goodExtraction({ amount: { value: "5000.00", confidence: 0.3, sourceExcerpt: "blurry total" } }),
      sources,
      { policyVersion: "FIN-4.2" },
    );
    expect(result).toEqual({ status: "NEEDS_REVIEW", reason: expect.stringContaining("LOW_CONFIDENCE") });
  });

  it("never invents a vendor that isn't in the system's own records", () => {
    const result = resolveExtraction(
      goodExtraction({
        vendorName: { value: "Totally Fake Vendor LLC", confidence: 0.99, sourceExcerpt: "Bill to: Totally Fake Vendor LLC" },
      }),
      sources,
      { policyVersion: "FIN-4.2" },
    );
    expect(result).toEqual({ status: "NEEDS_REVIEW", reason: expect.stringContaining("VENDOR_NOT_FOUND") });
  });

  it("rejects a PO that belongs to a different vendor than the one on the invoice", () => {
    const otherVendorPo: PurchaseOrder = { poId: "PO-99999", vendorId: "VEN-999", amount: "1.00", status: "OPEN" };
    const result = resolveExtraction(
      goodExtraction({ poReference: { value: "PO-99999", confidence: 0.9, sourceExcerpt: "PO PO-99999" } }),
      { ...sources, purchaseOrders: [po, otherVendorPo] },
      { policyVersion: "FIN-4.2" },
    );
    expect(result).toEqual({ status: "NEEDS_REVIEW", reason: expect.stringContaining("VENDOR_PO_MISMATCH") });
  });

  it("does not let a hallucinated wallet slip through unnoticed — the real kernel catches it downstream", () => {
    // The vendor and PO are real, so resolution succeeds — this is the case
    // HU-D2-12 is actually worried about: an extraction that's plausible
    // enough to resolve, but wrong on a field this function doesn't itself
    // verify. resolveExtraction's job ends at producing a candidate; the
    // guardrail is completing the loop through the untouched, already-tested
    // kernel rule (walletAttestation) below.
    const hallucinated = goodExtraction({
      walletAddress: { value: "GFAKEWALLETADDRESSNOTREAL0000", confidence: 0.9, sourceExcerpt: "Pay to GFAKE..." },
    });
    const resolved = resolveExtraction(hallucinated, sources, { policyVersion: "FIN-4.2" });
    expect(resolved.status).toBe("CANDIDATE");
    if (resolved.status !== "CANDIDATE") throw new Error("expected a candidate");

    const kernelResult = evaluatePayable(resolved.payable, {
      policy: {
        policyVersion: "FIN-4.2",
        rules: {
          require_po: true,
          require_receipt: true,
          amount_tolerance_pct: 2,
          duplicate_detection: true,
          wallet_change_requires_human: true,
          auto_pay_below: "1000.00",
          second_approval_above: "5000.00",
        },
      },
      now: new Date("2026-09-23T09:00:00Z"),
      knownInvoiceFingerprints: new Set(),
      settledInvoiceFingerprints: new Set(),
    });

    expect(kernelResult.status).toBe("BLOCKED");
    if (kernelResult.status === "BLOCKED") {
      expect(kernelResult.exceptions.map((e) => e.reason)).toContain("VENDOR_WALLET_CHANGED");
    }
  });

  it("ignores a low-confidence extracted wallet and falls back to the vendor's attested wallet", () => {
    const result = resolveExtraction(
      goodExtraction({
        walletAddress: { value: "billing@vendor.example", confidence: 0.4, sourceExcerpt: "billing@vendor.example" },
      }),
      sources,
      { policyVersion: "FIN-4.2" },
    );

    expect(result.status).toBe("CANDIDATE");
    if (result.status !== "CANDIDATE") return;
    expect(result.payable.invoice.walletAddress).toBe(vendorWallet.address);
  });
});
