import { z } from "zod";
import { OwnerRole } from "./schemas.js";

/**
 * The 11 reason codes from `Pakta_Documento_Maestro.md` §10.
 *
 * The Deterministic Control Kernel (`@pakta/rules-kernel`) produces 10 of
 * these. `ERP_POSTING_FAILED` fires *after* a confirmed on-chain
 * settlement when ERP posting fails — that's Dev 1/Accounting territory,
 * never emitted by the kernel. It's defined here anyway because this type
 * is the shared vocabulary the whole system (including Dev 1's side) reads
 * exception rows against.
 */
export const ExceptionReasonCode = z.enum([
  "DUPLICATE_INVOICE",
  "PO_AMOUNT_MISMATCH",
  "MISSING_RECEIPT",
  "PARTIAL_RECEIPT",
  "VENDOR_WALLET_CHANGED",
  "UNATTESTED_WALLET",
  "BUDGET_EXCEEDED",
  "APPROVAL_MISSING",
  "PROOF_EXPIRED",
  "PAYMENT_ALREADY_SETTLED",
  "ERP_POSTING_FAILED",
]);
export type ExceptionReasonCode = z.infer<typeof ExceptionReasonCode>;

export const ExceptionSeverity = z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
export type ExceptionSeverity = z.infer<typeof ExceptionSeverity>;

/**
 * Shape matches `Pakta_Documento_Maestro.md` §6.2 / §10's "propiedades de
 * una buena exception": deterministic code, human-readable explanation,
 * owner, required action, evidence pointer, revalidation semantics.
 */
export const Exception = z.object({
  payableId: z.string().min(1),
  status: z.literal("BLOCKED"),
  reason: ExceptionReasonCode,
  message: z.string().min(1),
  severity: ExceptionSeverity,
  ownerRole: OwnerRole,
  requiredAction: z.string().min(1),
  evidence: z.record(z.string(), z.unknown()).optional(),
  autoRevalidate: z.boolean(),
  policyVersion: z.string().min(1),
});
export type Exception = z.infer<typeof Exception>;
