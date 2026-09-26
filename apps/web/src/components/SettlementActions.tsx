"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { postAction } from "@/lib/postAction";

function randomTxHash(): string {
  return Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
}

/** READY todavía no tiene settlement — simula el reporte del Settlement Adapter de Dev 1. */
export function SimulateSettlementButton({ payableId, amount }: { payableId: string; amount: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function settle() {
    setPending(true);
    try {
      const body = {
        asset: "USDC",
        amount,
        txHash: randomTxHash(),
        ledger: Math.floor(Math.random() * 900_000) + 100_000,
      };
      if (await postAction(`/payables/${payableId}/settlement`, body)) router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <button onClick={settle} disabled={pending} className="app-button-primary">
      {pending ? "Liquidando…" : "Simular settlement"}
    </button>
  );
}

/** SETTLED con erpPostingStatus PENDING — simula la confirmación asíncrona del ERP. */
export function ReconcileButton({ payableId }: { payableId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function reconcile() {
    setPending(true);
    try {
      if (await postAction(`/payables/${payableId}/settlement`, { erpPostingStatus: "RECONCILED" }, "PATCH")) {
        router.refresh();
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <button onClick={reconcile} disabled={pending} className="app-button-secondary">
      {pending ? "Reconciliando…" : "Marcar reconciliado"}
    </button>
  );
}
