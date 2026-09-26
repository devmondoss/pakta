"use client";

import { useEffect, useState } from "react";
import type { Payable, ProofOfPayable, Vendor } from "@/lib/api";
import { ConfirmReceiptButton } from "@/components/ConfirmReceiptButton";
import { RevalidateButton } from "@/components/RevalidateButton";
import { StatusBadge, SeverityBadge } from "@/components/StatusBadge";
import { WalletActions } from "@/components/WalletActions";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const WALLET_REASONS = new Set(["VENDOR_WALLET_CHANGED", "UNATTESTED_WALLET"]);
const RECEIPT_REASONS = new Set(["MISSING_RECEIPT", "PARTIAL_RECEIPT"]);

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

export function PayableCard({ payable, vendor }: { payable: Payable; vendor?: Vendor }) {
  const [open, setOpen] = useState(false);
  const exception = payable.exception;

  return (
    <div className="rounded-2xl bg-surface shadow-[var(--shadow)]">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between gap-4 p-4 text-left">
        <div className="flex min-w-0 items-center gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{payable.vendorName}</p>
            <p className="truncate font-mono text-xs text-muted">
              {payable.invoiceId} · {payable.poId}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span className="font-mono text-sm">{payable.amount}</span>
          <StatusBadge status={payable.status} />
          <ChevronIcon open={open} />
        </div>
      </button>

      {open && (
        <div className="border-t border-border/60 p-4">
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
                <RevalidateButton payableId={payable.payableId} />
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <ProofDetail payableId={payable.payableId} />
              {payable.settlement && (
                <div className="flex flex-col gap-1 rounded-xl bg-settled-bg p-3 font-mono text-xs text-settled">
                  <span>tx_hash: {payable.settlement.txHash}</span>
                  <span>ledger: {payable.settlement.ledger}</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
