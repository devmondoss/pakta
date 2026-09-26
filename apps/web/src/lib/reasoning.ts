/**
 * Explicaciones en lenguaje llano para lo que ya calculó el rules-kernel
 * determinístico — no evalúa nada, solo narra datos que `Payable`/
 * `ProofOfPayable` ya traen. Nada de esto llama a un LLM: es una
 * reformulación fija de campos existentes, para que la demo se entienda
 * sin exponer hashes crudos como primera lectura.
 */
import type { Payable, ProofOfPayable } from "@/lib/api";

const REASON_LABELS: Record<string, string> = {
  DUPLICATE_INVOICE: "Factura duplicada",
  PO_AMOUNT_MISMATCH: "El monto no coincide con la PO",
  MISSING_RECEIPT: "Falta el receipt",
  PARTIAL_RECEIPT: "Receipt parcial",
  VENDOR_WALLET_CHANGED: "La wallet del proveedor cambió",
  UNATTESTED_WALLET: "Wallet sin atestar",
  BUDGET_EXCEEDED: "Excede el presupuesto",
  APPROVAL_MISSING: "Falta una aprobación",
  PROOF_EXPIRED: "El proof expiró",
  PAYMENT_ALREADY_SETTLED: "Ese pago ya se liquidó",
  ERP_POSTING_FAILED: "Falló el posteo al ERP",
};

export function reasonLabel(reason: string): string {
  return REASON_LABELS[reason] ?? reason;
}

/** `requiredAction` llega como código (p. ej. "REJECT_OR_REVIEW") — @pakta/rules-kernel's reasonCodeMetadata.ts, no como oración. */
const REQUIRED_ACTION_LABELS: Record<string, string> = {
  REJECT_OR_REVIEW: "Rechazar la factura o revisarla manualmente antes de continuar.",
  AMEND_PO_OR_CREDIT_NOTE: "Corregir la orden de compra o pedir una nota de crédito por la diferencia.",
  CONFIRM_RECEIPT: "Confirmar que la mercadería o el servicio se recibió.",
  PARTIAL_PAYMENT_OR_WAIT: "Liquidar solo la parte recibida o esperar a que llegue el resto.",
  REVERIFY_VENDOR_WALLET: "Volver a verificar la wallet del proveedor antes de pagar a la nueva dirección.",
  ATTEST_WALLET: "Atestar la wallet del proveedor.",
  REQUEST_BUDGET_APPROVAL: "Pedir aprobación de presupuesto al dueño del budget.",
  APPROVE_OR_REJECT: "Aprobar o rechazar el pago — falta una firma.",
  REVALIDATE_PROOF: "Revalidar el proof-of-payable — expiró.",
  BLOCK_PAYMENT: "Bloquear el pago — ya se liquidó antes.",
  RECONCILE_MANUALLY_OR_RETRY: "Reconciliar manualmente con el ERP o reintentar el posteo.",
};

export function requiredActionLabel(action: string): string {
  return REQUIRED_ACTION_LABELS[action] ?? action;
}

/** Checklist en lenguaje llano de por qué un payable READY quedó habilitado — derivado del proof, no evaluado de nuevo. */
export function explainReady(proof: ProofOfPayable): { label: string; detail: string }[] {
  return [
    { label: "Factura vs. orden de compra", detail: `${proof.po_hash.slice(0, 10)}… coincide dentro de tolerancia` },
    { label: "Recepción", detail: "confirmada contra el receipt registrado" },
    {
      label: "Wallet del proveedor",
      detail: `atestada (v${proof.wallet_attestation_version}) — destino verificado`,
    },
    { label: "Política aplicada", detail: `${proof.policy_version} — todas las condiciones se cumplen` },
    { label: "Aprobaciones", detail: "verificadas contra el registro de aprobadores" },
  ];
}

/** Pasos narrados tipo "cómo se decidió" — mock de razonamiento, 100% derivado de campos ya calculados por el kernel. Nunca reemplaza al motor determinístico, solo lo explica. */
export function reasoningTrace(payable: Payable, proof: ProofOfPayable | null): string[] {
  const base = `Leí ${payable.invoiceId} de ${payable.vendorName} por USD ${payable.amount}, vinculada a ${payable.poId}.`;

  if (payable.exception) {
    const ex = payable.exception;
    return [
      base,
      `Crucé la factura, la PO y el receipt contra las reglas del kernel determinístico.`,
      `Encontré una violación: ${reasonLabel(ex.reason)} (severidad ${ex.severity}).`,
      `Acción requerida: ${requiredActionLabel(ex.requiredAction)} — responsable: ${ex.ownerRole}.`,
    ];
  }

  if (proof) {
    return [
      base,
      `Crucé la factura, la PO y el receipt: coinciden dentro de la tolerancia permitida.`,
      `Verifiqué la wallet del proveedor (atestación v${proof.wallet_attestation_version}) contra el proof.`,
      `Evalué la política ${proof.policy_version}: se cumplen todas las condiciones → habilitado para settlement.`,
    ];
  }

  if (payable.settlement) {
    return [
      base,
      `El proof-of-payable habilitó el settlement; se liquidó en Stellar (ledger ${payable.settlement.ledger}).`,
      payable.settlement.erpPostingStatus === "RECONCILED"
        ? `El posteo al ERP quedó reconciliado — ciclo cerrado.`
        : `Posteo al ERP pendiente de reconciliar.`,
    ];
  }

  return [base, `Evaluando contra las reglas del kernel determinístico…`];
}
