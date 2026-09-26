"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { postAction } from "@/lib/postAction";

/** DUPLICATE_INVOICE: AP revisó el fingerprint marcado y confirmó que no es un reenvío. */
export function DismissDuplicateButton({ payableId }: { payableId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [confirming, setConfirming] = useState(false);

  async function dismiss() {
    setConfirming(false);
    setPending(true);
    try {
      if (await postAction(`/payables/${payableId}/dismiss-duplicate`)) router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <button onClick={() => setConfirming(true)} disabled={pending} className="app-button-primary">
        {pending ? "Descartando…" : "No es duplicado"}
      </button>
      {confirming && (
        <ConfirmDialog
          title="Descartar duplicado"
          body="Confirmás que revisaste esta factura y NO es un duplicado."
          confirmLabel="Confirmar"
          onConfirm={dismiss}
          onCancel={() => setConfirming(false)}
        />
      )}
    </>
  );
}

/** PO_AMOUNT_MISMATCH: Procurement enmienda la PO al monto real facturado. */
export function AmendPoButton({ payableId }: { payableId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [confirming, setConfirming] = useState(false);

  async function amend() {
    setConfirming(false);
    setPending(true);
    try {
      if (await postAction(`/payables/${payableId}/amend-po`)) router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <button onClick={() => setConfirming(true)} disabled={pending} className="app-button-primary">
        {pending ? "Enmendando…" : "Enmendar PO"}
      </button>
      {confirming && (
        <ConfirmDialog
          title="Enmendar PO"
          body="La orden de compra va a quedar ajustada al monto facturado."
          confirmLabel="Enmendar"
          onConfirm={amend}
          onCancel={() => setConfirming(false)}
        />
      )}
    </>
  );
}
