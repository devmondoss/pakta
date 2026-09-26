"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { postAction } from "@/lib/postAction";

/**
 * SETTLED con erpPostingStatus PENDING. La reconciliación con el ERP del
 * cliente pasa por fuera de Pakta (`GET /reconciliation.csv` exporta los
 * settlements para que el ERP los importe) — Pakta no tiene ni puede tener
 * una integración real con el ERP interno de cada empresa. Este botón no
 * automatiza eso: registra el mismo gesto que haría un humano en el ERP
 * después de revisar el CSV, no una simulación de algo que en la vida real
 * sería automático.
 */
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
    <button onClick={reconcile} disabled={pending} className="app-button-secondary" title="Acción manual: confirma en Pakta lo que un humano ya verificó en el ERP.">
      {pending ? "Confirmando…" : "Confirmar reconciliación (manual)"}
    </button>
  );
}
