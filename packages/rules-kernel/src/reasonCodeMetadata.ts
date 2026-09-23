import type { ExceptionReasonCode, ExceptionSeverity, OwnerRole } from "@pakta/canonical-model";

/**
 * Static owner/severity/action metadata per reason code, from the table in
 * `Pakta_Documento_Maestro.md` §10. Rules reference this instead of each
 * hardcoding its own copy, so the owner/severity mapping only lives in one
 * place.
 *
 * `PAYMENT_ALREADY_SETTLED` gets `autoRevalidate: false` on purpose — it
 * signals a possible double-pay/replay (threat model §14 item 4), which
 * needs manual review, not a silent auto-retry.
 *
 * `ERP_POSTING_FAILED` is defined here for completeness (it's part of the
 * shared reason-code vocabulary) but this kernel never emits it — it fires
 * after a confirmed settlement, on Dev 1/Accounting's side.
 */
export const REASON_CODE_METADATA: Record<
  ExceptionReasonCode,
  { ownerRole: OwnerRole; requiredAction: string; severity: ExceptionSeverity; autoRevalidate: boolean }
> = {
  DUPLICATE_INVOICE: { ownerRole: "AP", requiredAction: "REJECT_OR_REVIEW", severity: "CRITICAL", autoRevalidate: true },
  PO_AMOUNT_MISMATCH: { ownerRole: "PROCUREMENT", requiredAction: "AMEND_PO_OR_CREDIT_NOTE", severity: "HIGH", autoRevalidate: true },
  MISSING_RECEIPT: { ownerRole: "OPERATIONS", requiredAction: "CONFIRM_RECEIPT", severity: "MEDIUM", autoRevalidate: true },
  PARTIAL_RECEIPT: { ownerRole: "OPERATIONS", requiredAction: "PARTIAL_PAYMENT_OR_WAIT", severity: "MEDIUM", autoRevalidate: true },
  VENDOR_WALLET_CHANGED: { ownerRole: "VENDOR_MASTER", requiredAction: "REVERIFY_VENDOR_WALLET", severity: "CRITICAL", autoRevalidate: true },
  UNATTESTED_WALLET: { ownerRole: "VENDOR_MASTER", requiredAction: "ATTEST_WALLET", severity: "CRITICAL", autoRevalidate: true },
  BUDGET_EXCEEDED: { ownerRole: "BUDGET_OWNER", requiredAction: "REQUEST_BUDGET_APPROVAL", severity: "HIGH", autoRevalidate: true },
  APPROVAL_MISSING: { ownerRole: "CONTROLLER", requiredAction: "APPROVE_OR_REJECT", severity: "MEDIUM", autoRevalidate: true },
  PROOF_EXPIRED: { ownerRole: "AP", requiredAction: "REVALIDATE_PROOF", severity: "MEDIUM", autoRevalidate: true },
  PAYMENT_ALREADY_SETTLED: { ownerRole: "AP", requiredAction: "BLOCK_PAYMENT", severity: "CRITICAL", autoRevalidate: false },
  ERP_POSTING_FAILED: { ownerRole: "ACCOUNTING", requiredAction: "RECONCILE_MANUALLY_OR_RETRY", severity: "HIGH", autoRevalidate: false },
};
