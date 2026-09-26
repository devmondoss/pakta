"use client";

import { useEffect, useState } from "react";
import type { Payable, ProofOfPayable, Vendor } from "@/lib/api";
import { ConfirmReceiptButton } from "@/components/ConfirmReceiptButton";
import { AmendPoButton, DismissDuplicateButton } from "@/components/ExceptionResolutionActions";
import { ReasoningTrace } from "@/components/ReasoningTrace";
import { RevalidateButton } from "@/components/RevalidateButton";
import { SettleButton } from "@/components/SettleButton";
import { StatusBadge, SeverityBadge } from "@/components/StatusBadge";
import { WalletActions } from "@/components/WalletActions";
import { blockedNarrative, explainReady, reasoningTrace, requiredActionLabel } from "@/lib/reasoning";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const WALLET_REASONS = new Set(["VENDOR_WALLET_CHANGED", "UNATTESTED_WALLET"]);
const RECEIPT_REASONS = new Set(["MISSING_RECEIPT", "PARTIAL_RECEIPT"]);
const DUPLICATE_REASONS = new Set(["DUPLICATE_INVOICE"]);
const AMOUNT_REASONS = new Set(["PO_AMOUNT_MISMATCH"]);

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className={`text-muted transition-transform ${open ? "rotate-180" : ""}`}
    >
      <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function formatDueDate(dueDate: string): string {
  return new Date(`${dueDate}T00:00:00`).toLocaleDateString("es", { day: "2-digit", month: "short" });
}

function useProof(payableId: string): ProofOfPayable | "loading" | "error" {
  const [proof, setProof] = useState<ProofOfPayable | "loading" | "error">("loading");

  useEffect(() => {
    let active = true;
    fetch(`${API_URL}/payables/${payableId}/proof`)
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data) => active && setProof(data))
      .catch(() => active && setProof("error"));
    return () => {
      active = false;
    };
  }, [payableId]);

  return proof;
}

/** Por qué este payable quedó READY — checklist en lenguaje llano primero, hashes crudos detrás de un toggle. */
function ProofDetail({ payable }: { payable: Payable }) {
  const proof = useProof(payable.payableId);
  const [showRaw, setShowRaw] = useState(false);

  if (proof === "loading") return <p className="text-xs text-muted">Cargando proof…</p>;
  if (proof === "error") return <p className="text-xs text-muted">No se pudo cargar el proof.</p>;

  return (
    <div className="flex flex-col gap-3">
      <ul className="payable-checklist">
        {explainReady(proof).map((item, i) => (
          <li
            key={item.label}
            className="payable-checklist-item"
            style={{ animationDelay: `${i * 90}ms` }}
          >
            <span className="payable-checklist-mark" style={{ animationDelay: `${i * 90 + 120}ms` }}>✓</span>
            <span>
              <span className="payable-checklist-label">{item.label}</span> — {item.detail}
            </span>
          </li>
        ))}
      </ul>
      <button type="button" onClick={() => setShowRaw((v) => !v)} className="payable-raw-toggle">
        {showRaw ? "Ocultar" : "Ver"} detalle técnico
      </button>
      {showRaw && (
        <div className="flex flex-col gap-1.5 font-mono text-xs text-muted">
          <span>wallet: {proof.vendor_wallet}</span>
          <span>invoice_hash: {proof.invoice_hash}</span>
          <span>po_hash: {proof.po_hash.slice(0, 24)}…</span>
          <span>expires_at: {new Date(proof.expires_at).toLocaleString("es")}</span>
        </div>
      )}
      <ReasoningTrace steps={reasoningTrace(payable, proof)} />
    </div>
  );
}

export type PayableCardFocus = "all" | "exception" | "proof" | "settle" | "reconcile";

/**
 * `focus` recorta qué sección del detalle se muestra — cada slide del
 * pipeline (Resolución/Proof-of-Payable/Settlement/Reconciliación) le pasa
 * su propio foco, para que la misma tarjeta no repita exactamente lo mismo
 * en cada etapa. `collapsible=false` la deja siempre abierta y sin botón:
 * en un slide dedicado no hace falta un click extra para ver lo único que
 * hay que ver ahí.
 */
export function PayableCard({
  payable,
  vendor,
  settlementEnabled,
  focus = "all",
  collapsible = true,
}: {
  payable: Payable;
  vendor?: Vendor;
  settlementEnabled: boolean;
  focus?: PayableCardFocus;
  collapsible?: boolean;
}) {
  const [open, setOpen] = useState(!collapsible);
  const exception = payable.exception;
  const showExceptionActions = focus === "all" || focus === "exception";
  // El checklist de por qué está READY se muestra tanto en Proof-of-Payable
  // como en Settlement — en Settlement es justo donde más falta contexto,
  // porque ahí el usuario decide si confía en apretar "Liquidar".
  const showProof = (focus === "all" || focus === "proof" || focus === "settle") && payable.status === "READY";
  const showSettle = (focus === "all" || focus === "settle") && payable.status === "READY";
  const showSettlementInfo = (focus === "all" || focus === "reconcile") && payable.settlement;

  const headerRows = (
    <>
      <div className="payable-card-row">
        <p className="payable-card-vendor truncate">{payable.vendorName}</p>
        <StatusBadge status={payable.status} />
      </div>
      <div className="payable-card-row">
        <span className="payable-card-amount">USD {payable.amount}</span>
        <span className="payable-card-due">Vence {formatDueDate(payable.dueDate)}</span>
      </div>
      <div className="payable-card-row">
        <p className="payable-card-id truncate">
          {payable.invoiceId} · {payable.poId}
        </p>
        {collapsible && <ChevronIcon open={open} />}
      </div>
    </>
  );

  return (
    <div className="payable-card">
      {collapsible ? (
        <button onClick={() => setOpen((v) => !v)} className="payable-card-trigger">
          {headerRows}
        </button>
      ) : (
        <div className="payable-card-trigger payable-card-trigger-static">{headerRows}</div>
      )}

      {open && (
        <div className="payable-card-detail">
          {exception && showExceptionActions ? (
            <div className="flex flex-col gap-3">
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm text-foreground/90">{blockedNarrative(payable)}</p>
                <SeverityBadge severity={exception.severity} />
              </div>
              <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-muted">
                <span>
                  Reason: <code className="text-foreground">{exception.reason}</code>
                </span>
                <span>
                  Owner: <span className="text-foreground">{exception.ownerRole}</span>
                </span>
              </div>
              <div className="payable-required-action">
                <span className="payable-required-action-label">Qué hacer</span>
                <p>{requiredActionLabel(exception.requiredAction)}</p>
              </div>
                <div className="flex flex-wrap items-center gap-2 pt-1">
                {WALLET_REASONS.has(exception.reason) && (
                  <WalletActions vendorId={payable.vendorId} attestationStatus={vendor?.wallet?.attestationStatus} />
                )}
                {RECEIPT_REASONS.has(exception.reason) && <ConfirmReceiptButton payableId={payable.payableId} />}
                {DUPLICATE_REASONS.has(exception.reason) && <DismissDuplicateButton payableId={payable.payableId} />}
                {AMOUNT_REASONS.has(exception.reason) && <AmendPoButton payableId={payable.payableId} />}
                <RevalidateButton payableId={payable.payableId} />
              </div>
              <ReasoningTrace steps={reasoningTrace(payable, null)} />
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {showProof && <ProofDetail payable={payable} />}
              {showSettle && (
                <SettleButton
                  payableId={payable.payableId}
                  vendorName={payable.vendorName}
                  amount={payable.amount}
                  enabled={settlementEnabled}
                />
              )}
              {showSettlementInfo && payable.settlement && (
                <div className="payable-settlement flex flex-col gap-2 font-mono text-xs">
                  <a
                    href={payable.settlement.explorerUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="break-all underline decoration-settled/50 underline-offset-2 hover:decoration-settled"
                  >
                    tx_hash: {payable.settlement.txHash}
                  </a>
                  <span>ledger: {payable.settlement.ledger}</span>
                  <span className="break-all">proof_hash: {payable.settlement.proofHash}</span>
                  <span>ERP: {payable.settlement.erpPostingStatus}</span>
                </div>
              )}
              {showSettlementInfo && payable.settlement && <ReasoningTrace steps={reasoningTrace(payable, null)} />}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
