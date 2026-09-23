import { z } from "zod";

/**
 * The Canonical Payable Model — the single shape every source (Excel/CSV,
 * PDF/email extraction, ERP connectors) normalizes into before the
 * Deterministic Control Kernel ever sees it. See
 * `Pakta_Documento_Maestro.md` §7.0.
 *
 * Money is always a decimal string, never `number` — the rules kernel does
 * tolerance math on it (via decimal.js) and floats would silently corrupt
 * that comparison.
 */
const decimalString = z
  .string()
  .regex(/^\d+(\.\d{1,2})?$/, "must be a plain decimal string, e.g. \"5000.00\"");

export const OwnerRole = z.enum([
  "AP",
  "PROCUREMENT",
  "OPERATIONS",
  "VENDOR_MASTER",
  "BUDGET_OWNER",
  "CONTROLLER",
  "ACCOUNTING",
]);
export type OwnerRole = z.infer<typeof OwnerRole>;

export const VendorVerificationStatus = z.enum(["UNVERIFIED", "VERIFIED", "SUSPENDED"]);
export type VendorVerificationStatus = z.infer<typeof VendorVerificationStatus>;

export const Vendor = z.object({
  vendorId: z.string().min(1),
  legalName: z.string().min(1),
  verificationStatus: VendorVerificationStatus,
});
export type Vendor = z.infer<typeof Vendor>;

export const WalletAttestationStatus = z.enum(["ATTESTED", "UNATTESTED"]);
export type WalletAttestationStatus = z.infer<typeof WalletAttestationStatus>;

export const VendorWallet = z.object({
  vendorId: z.string().min(1),
  address: z.string().min(1),
  attestationStatus: WalletAttestationStatus,
  version: z.number().int().positive(),
  createdAt: z.coerce.date(),
});
export type VendorWallet = z.infer<typeof VendorWallet>;

export const PurchaseOrderStatus = z.enum(["OPEN", "CLOSED", "CANCELLED"]);

export const PurchaseOrder = z.object({
  poId: z.string().min(1),
  vendorId: z.string().min(1),
  amount: decimalString,
  status: PurchaseOrderStatus,
  approverId: z.string().min(1).optional(),
});
export type PurchaseOrder = z.infer<typeof PurchaseOrder>;

export const Invoice = z.object({
  invoiceId: z.string().min(1),
  poId: z.string().min(1).optional(),
  vendorId: z.string().min(1),
  amount: decimalString,
  dueDate: z.coerce.date(),
  walletAddress: z.string().min(1),
  /** Hash of the source row/document — §13.1: documents stay off-chain, only the hash travels. */
  sourceHash: z.string().min(1),
});
export type Invoice = z.infer<typeof Invoice>;

export const Receipt = z.object({
  poId: z.string().min(1),
  confirmedQty: z.number().nonnegative(),
  invoicedQty: z.number().positive().optional(),
  confirmedBy: z.string().min(1),
  confirmedAt: z.coerce.date(),
});
export type Receipt = z.infer<typeof Receipt>;

export const ApprovalObjectType = z.enum(["PO", "INVOICE", "PAYABLE"]);

export const Approval = z.object({
  objectType: ApprovalObjectType,
  objectId: z.string().min(1),
  policyVersion: z.string().min(1),
  approverId: z.string().min(1),
  timestamp: z.coerce.date(),
});
export type Approval = z.infer<typeof Approval>;

/**
 * One per INVOICES row, joined with its PO/Vendor/Receipts/Approvals.
 * `purchaseOrder`/`vendorWallet` are optional because policy may allow a
 * payable without a PO (`policy.require_po === false`) or without an
 * attested wallet yet (the kernel will block it, ingestion doesn't).
 */
export const CanonicalPayable = z.object({
  payableId: z.string().min(1),
  invoice: Invoice,
  purchaseOrder: PurchaseOrder.optional(),
  vendor: Vendor,
  vendorWallet: VendorWallet.optional(),
  receipts: z.array(Receipt),
  approvals: z.array(Approval),
  policyVersion: z.string().min(1),
  /** Set once a Proof-of-Payable exists — absent for every freshly-ingested payable. */
  expiresAt: z.coerce.date().optional(),
});
export type CanonicalPayable = z.infer<typeof CanonicalPayable>;
