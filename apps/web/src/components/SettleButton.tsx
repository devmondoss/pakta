"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { postAction } from "@/lib/postAction";

export function SettleButton({ payableId, vendorName, amount, enabled }: {
  payableId: string;
  vendorName: string;
  amount: string;
  enabled: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [confirming, setConfirming] = useState(false);

  async function settle() {
    setConfirming(false);
    setPending(true);
    try {
      if (await postAction(`/payables/${encodeURIComponent(payableId)}/settle`)) router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setConfirming(true)}
        disabled={!enabled || pending}
        title={enabled ? "Registrar el proof y liquidar en Stellar" : "Settlement no configurado en la API"}
        className="rounded-full bg-ready px-3 py-1 text-xs font-semibold text-background hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {pending ? "Liquidando…" : "Liquidar en Stellar"}
      </button>
      {confirming && (
        <ConfirmDialog
          title="Confirmar settlement"
          body="La operación se enviará a la red y no se puede deshacer."
          details={[
            { label: "Proveedor", value: vendorName },
            { label: "Monto", value: `${amount} USDC` },
            { label: "Red", value: "Stellar testnet" },
          ]}
          confirmLabel="Liquidar"
          onConfirm={settle}
          onCancel={() => setConfirming(false)}
        />
      )}
    </>
  );
}
