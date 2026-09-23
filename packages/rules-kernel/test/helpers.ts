import type { CanonicalPayable, Policy } from "@pakta/canonical-model";
import type { RuleContext } from "../src/types.js";

/** A minimal, always-valid CanonicalPayable — tests override only what they care about. */
export function buildPayable(overrides: Partial<CanonicalPayable> = {}): CanonicalPayable {
  return {
    payableId: "PAY-TEST-001",
    invoice: {
      invoiceId: "INV-TEST-001",
      poId: "PO-TEST-001",
      vendorId: "VEN-TEST-001",
      amount: "1000.00",
      dueDate: new Date("2026-09-23"),
      walletAddress: "GTESTWALLET1",
      sourceHash: "sha256:test",
    },
    purchaseOrder: {
      poId: "PO-TEST-001",
      vendorId: "VEN-TEST-001",
      amount: "1000.00",
      status: "OPEN",
      approverId: "controller@pakta.demo",
    },
    vendor: {
      vendorId: "VEN-TEST-001",
      legalName: "Test Vendor Inc.",
      verificationStatus: "VERIFIED",
    },
    vendorWallet: {
      vendorId: "VEN-TEST-001",
      address: "GTESTWALLET1",
      attestationStatus: "ATTESTED",
      version: 1,
      createdAt: new Date("2026-01-01"),
    },
    receipts: [
      {
        poId: "PO-TEST-001",
        confirmedQty: 1,
        invoicedQty: 1,
        confirmedBy: "ops@pakta.demo",
        confirmedAt: new Date("2026-09-20"),
      },
    ],
    approvals: [
      {
        objectType: "PO",
        objectId: "PO-TEST-001",
        policyVersion: "FIN-4.2",
        approverId: "controller@pakta.demo",
        timestamp: new Date("2026-09-15"),
      },
    ],
    policyVersion: "FIN-4.2",
    ...overrides,
  };
}

export const testPolicy: Policy = {
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
};

export function buildContext(overrides: Partial<RuleContext> = {}): RuleContext {
  return {
    policy: testPolicy,
    now: new Date("2026-09-23T12:00:00Z"),
    knownInvoiceFingerprints: new Set(),
    settledInvoiceFingerprints: new Set(),
    ...overrides,
  };
}
