"use client";

import { useEffect, useState } from "react";
import type { Payable, ProofOfPayable, Vendor } from "@/lib/api";
import { ConfirmReceiptButton } from "@/components/ConfirmReceiptButton";
import { AmendPoButton, DismissDuplicateButton } from "@/components/ExceptionResolutionActions";
import { RevalidateButton } from "@/components/RevalidateButton";
import { SettleButton } from "@/components/SettleButton";
import { ReconcileButton } from "@/components/SettlementActions";
import { StatusBadge, SeverityBadge } from "@/components/StatusBadge";
import { WalletActions } from "@/components/WalletActions";

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

function ProofDetail({ payableId }: { payableId: string }) {
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

  if (proof === "loading") return <p className="text-xs text-muted">Cargando proof…</p>;
  if (proof === "error") return <p className="text-xs text-muted">No se pudo cargar el proof.</p>;

  return (
    <div className="flex flex-col gap-1.5 font-mono text-xs text-muted">
      <span>wallet: {proof.vendor_wallet}</span>
      <span>invoice_hash: {proof.invoice_hash}</span>
      <span>po_hash: {proof.po_hash.slice(0, 24)}…</span>
      <span>expires_at: {new Date(proof.expires_at).toLocaleString("es")}</span>
    </div>
  );
}

export function PayableCard({ payable, vendor, settlementEnabled }: { payable: Payable; vendor?: Vendor; settlementEnabled: boolean }) {
  const [open, setOpen] = useState(false);
  const exception = payable.exception;

  return (
    <div className="payable-card">
      <button onClick={() => setOpen((v) => !v)} className="payable-card-trigger">
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
          <ChevronIcon open={open} />
        </div>
      </button>

      {open && (
        <div className="payable-card-detail">
          {exception ? (
            <div className="flex flex-col gap-3">
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm text-foreground/90">{exception.message}</p>
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
                <div className="flex flex-wrap items-center gap-2 pt-1">
                {WALLET_REASONS.has(exception.reason) && (
                  <WalletActions vendorId={payable.vendorId} attestationStatus={vendor?.wallet?.attestationStatus} />
                )}
                {RECEIPT_REASONS.has(exception.reason) && <ConfirmReceiptButton payableId={payable.payableId} />}
                {DUPLICATE_REASONS.has(exception.reason) && <DismissDuplicateButton payableId={payable.payableId} />}
                {AMOUNT_REASONS.has(exception.reason) && <AmendPoButton payableId={payable.payableId} />}
                <RevalidateButton payableId={payable.payableId} />
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {payable.status === "READY" && <ProofDetail payableId={payable.payableId} />}
              {payable.status === "READY" && (
                <SettleButton
                  payableId={payable.payableId}
                  vendorName={payable.vendorName}
                  amount={payable.amount}
                  enabled={settlementEnabled}
                />
              )}
              {payable.settlement && (
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
                  {payable.settlement.erpPostingStatus === "PENDING" && (
                    <div className="pt-1">
                      <ReconcileButton payableId={payable.payableId} />
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
