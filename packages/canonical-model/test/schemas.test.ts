import { describe, expect, it } from "vitest";
import {
  CanonicalPayable,
  Exception,
  ProofOfPayable,
  Settlement,
  Vendor,
} from "../src/index";

describe("Vendor", () => {
  it("accepts a valid vendor", () => {
    const result = Vendor.safeParse({
      vendorId: "VEN-001",
      legalName: "CloudData Inc.",
      verificationStatus: "VERIFIED",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an unknown verificationStatus", () => {
    const result = Vendor.safeParse({
      vendorId: "VEN-001",
      legalName: "CloudData Inc.",
      verificationStatus: "TRUSTED", // not a real status
    });
    expect(result.success).toBe(false);
  });
});

describe("CanonicalPayable", () => {
  const base = {
    payableId: "PAY-INV-001",
    invoice: {
      invoiceId: "INV-001",
      poId: "PO-72881",
      vendorId: "VEN-001",
      amount: "5000.00",
      dueDate: "2026-09-23",
      walletAddress: "GA1CD9F3KXQPLMN7R2WZT8VY",
      sourceHash: "sha256:abc123",
    },
    vendor: {
      vendorId: "VEN-001",
      legalName: "CloudData Inc.",
      verificationStatus: "VERIFIED" as const,
    },
    receipts: [],
    approvals: [],
    policyVersion: "FIN-4.2",
  };

  it("accepts a minimal valid payable (no PO, no wallet, no receipts/approvals)", () => {
    expect(CanonicalPayable.safeParse(base).success).toBe(true);
  });

  it("rejects a non-decimal amount", () => {
    const bad = { ...base, invoice: { ...base.invoice, amount: "5,000" } };
    expect(CanonicalPayable.safeParse(bad).success).toBe(false);
  });
});

describe("Exception", () => {
  it("accepts a well-formed VENDOR_WALLET_CHANGED exception", () => {
    const result = Exception.safeParse({
      payableId: "PAY-INV-004",
      status: "BLOCKED",
      reason: "VENDOR_WALLET_CHANGED",
      message: "El proveedor pide pagar a una wallet distinta a la registrada.",
      severity: "CRITICAL",
      ownerRole: "VENDOR_MASTER",
      requiredAction: "REVERIFY_VENDOR_WALLET",
      autoRevalidate: true,
      policyVersion: "FIN-4.2",
    });
    expect(result.success).toBe(true);
  });
});

describe("shared contract with Dev 1 (ProofOfPayable / Settlement)", () => {
  it("accepts the ProofOfPayable shape verbatim from Pakta_Division_Trabajo.md §5", () => {
    const result = ProofOfPayable.safeParse({
      payable_id: "PAY-2026-9182",
      invoice_hash: "0x...",
      po_hash: "0x...",
      vendor_id: "VEN-819",
      vendor_wallet: "GABC...",
      wallet_attestation_version: 7,
      amount: "8430.00",
      asset: "USDC",
      policy_version: "FIN-4.2",
      approvals_hash: "0x...",
      cost_center: "INFRA-042",
      expires_at: "2026-09-25T18:00:00Z",
      status: "READY",
    });
    expect(result.success).toBe(true);
  });

  it("accepts the Settlement shape verbatim from Pakta_Division_Trabajo.md §5", () => {
    const result = Settlement.safeParse({
      payable_id: "PAY-2026-9182",
      invoice_id: "INV-2817",
      po_id: "PO-1829",
      settlement: {
        network: "stellar",
        asset: "USDC",
        amount: "8430.00",
        tx_hash: "abx932...",
        ledger: 12345678,
      },
      status: "SETTLED",
      erp_posting_status: "RECONCILED",
    });
    expect(result.success).toBe(true);
  });
});
