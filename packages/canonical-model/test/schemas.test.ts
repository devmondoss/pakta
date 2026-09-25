import { describe, expect, it } from "vitest";
import {
  CanonicalPayable,
  Exception,
  ProofOfPayable,
  Settlement,
  SignedProofOfPayable,
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

describe("shared contract with Dev 1 (ProofOfPayable v1.1 / Settlement)", () => {
  const VALID_PROOF = {
    payable_id: "PAY-2026-9182",
    invoice_hash: "a".repeat(64),
    po_hash: "b".repeat(64),
    receipt_hash: "c".repeat(64),
    vendor_id: "VEN-004",
    vendor_wallet: "GCWHVCDLQWRHPXUJFSSM2J6PEFUHLDBZ77XRWQM5MA3ULYMYY3K7EPNO",
    wallet_attestation_version: 6,
    amount: "8000.00",
    asset: "USDC",
    policy_version: "FIN-4.2",
    approvals_hash: "d".repeat(64),
    cost_center: "INFRA-042",
    expires_at: "2026-09-25T18:00:00Z",
    status: "READY",
  } as const;

  it("accepts a well-formed v1.1 proof", () => {
    expect(ProofOfPayable.safeParse(VALID_PROOF).success).toBe(true);
  });

  // Each of these passed v1.0 and could never have settled.
  it.each([
    ["expires_at with milliseconds", { expires_at: "2026-09-25T18:00:00.000Z" }],
    ["expires_at with an offset", { expires_at: "2026-09-25T18:00:00+00:00" }],
    ["a sha256: prefixed evidence hash", { invoice_hash: `sha256:${"a".repeat(64)}` }],
    ["a 0x prefixed evidence hash", { po_hash: `0x${"b".repeat(64)}` }],
    ["a placeholder evidence hash", { invoice_hash: "sha256:demo-inv-001" }],
    ["the 24-character placeholder wallet", { vendor_wallet: "GA1CD9F3KXQPLMN7R2WZT8VY" }],
    ["an amount with leading zeros", { amount: "05000.00" }],
    ["an amount finer than 7 decimals", { amount: "1.00000001" }],
    ["a zero amount", { amount: "0.00" }],
  ])("rejects %s", (_label, override) => {
    expect(ProofOfPayable.safeParse({ ...VALID_PROOF, ...override }).success).toBe(false);
  });

  it("requires receipt_hash, which v1.0 did not carry", () => {
    const { receipt_hash: _dropped, ...withoutReceipt } = VALID_PROOF;
    expect(ProofOfPayable.safeParse(withoutReceipt).success).toBe(false);
  });

  it("rejects unknown fields, because they would change proof_hash silently", () => {
    expect(ProofOfPayable.safeParse({ ...VALID_PROOF, extra: "x" }).success).toBe(false);
  });

  it("accepts a signed envelope and rejects a malformed signature", () => {
    const signed = {
      ...VALID_PROOF,
      proof_hash: "e".repeat(64),
      issuer_public_key: "GCHMGWSGJS4CNBLWF2SBQVUGAF674RWCT5DFK5QENPVL6UCLAXQT2MVL",
      issuer_signature: `${"A".repeat(86)}==`,
      network_passphrase: "Test SDF Network ; September 2015",
      contract_id: "CDKC6UYM7JFZOIR3DSSHZWSNFB4NTYQ3X3AVJJ5MIU3UH6H4NBQON5GB",
    };
    expect(SignedProofOfPayable.safeParse(signed).success).toBe(true);
    expect(SignedProofOfPayable.safeParse({ ...signed, issuer_signature: "not-a-signature" }).success).toBe(false);
    expect(SignedProofOfPayable.safeParse({ ...signed, contract_id: "GCHMGWSGJS4CNBLWF2SBQVUGAF674RWCT5DFK5QENPVL6UCLAXQT2MVL" }).success).toBe(false);
  });

  it("accepts a v1.1 Settlement carrying proof_hash and contract_id", () => {
    const result = Settlement.safeParse({
      payable_id: "PAY-2026-9182",
      invoice_id: "INV-2817",
      po_id: "PO-1829",
      proof_hash: "e".repeat(64),
      contract_id: "CDKC6UYM7JFZOIR3DSSHZWSNFB4NTYQ3X3AVJJ5MIU3UH6H4NBQON5GB",
      settlement: {
        network: "stellar",
        asset: "USDC",
        amount: "8430.00",
        tx_hash: "f".repeat(64),
        ledger: 12345678,
      },
      status: "SETTLED",
      erp_posting_status: "RECONCILED",
    });
    expect(result.success).toBe(true);
  });
});
