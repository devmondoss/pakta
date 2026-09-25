import type { CanonicalPayable, Settlement } from "@pakta/canonical-model";
import type { KernelResult } from "@pakta/rules-kernel";

/**
 * Shape mirrors `apps/web/src/lib/mock-data.ts`'s `Payable` type — the
 * frontend was built against that shape first, so the API matches it
 * instead of the other way around.
 */
export type ApiPayable = {
  payableId: string;
  invoiceId: string;
  vendorName: string;
  vendorId: string;
  poId: string;
  amount: string;
  dueDate: string;
  status: "READY" | "BLOCKED" | "SETTLED";
  exception?: {
    reason: string;
    message: string;
    severity: string;
    ownerRole: string;
    requiredAction: string;
  };
  settlement?: {
    txHash: string;
    ledger: number;
    network: string;
    erpPostingStatus: string;
  };
};

/**
 * `settlement`, when present, wins over the kernel's own READY/BLOCKED —
 * once Dev 1 reports a payable settled it stays SETTLED regardless of
 * what a re-evaluation would say (the kernel has no notion of settlement
 * at all; that state lives only in `@pakta/db`'s `settlements` table).
 */
export function toApiPayable(payable: CanonicalPayable, result: KernelResult, settlement?: Settlement): ApiPayable {
  const base: ApiPayable = {
    payableId: payable.payableId,
    invoiceId: payable.invoice.invoiceId,
    vendorName: payable.vendor.legalName,
    vendorId: payable.vendor.vendorId,
    poId: payable.purchaseOrder?.poId ?? payable.invoice.poId ?? "",
    amount: payable.invoice.amount,
    dueDate: payable.invoice.dueDate.toISOString().slice(0, 10),
    status: result.status,
  };

  if (settlement) {
    base.status = "SETTLED";
    base.settlement = {
      txHash: settlement.settlement.tx_hash,
      ledger: settlement.settlement.ledger,
      network: settlement.settlement.network,
      erpPostingStatus: settlement.erp_posting_status,
    };
    return base;
  }

  if (result.status === "BLOCKED") {
    const { primaryException } = result;
    base.exception = {
      reason: primaryException.reason,
      message: primaryException.message,
      severity: primaryException.severity,
      ownerRole: primaryException.ownerRole,
      requiredAction: primaryException.requiredAction,
    };
  }

  return base;
}
