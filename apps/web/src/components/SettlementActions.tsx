"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { postAction } from "@/lib/postAction";

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
