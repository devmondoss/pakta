"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { postAction } from "@/lib/postAction";

/** DUPLICATE_INVOICE: AP revisó el fingerprint marcado y confirmó que no es un reenvío. */
export function DismissDuplicateButton({ payableId }: { payableId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function dismiss() {
    if (!window.confirm("¿Confirmás que revisaste esta factura y NO es un duplicado?")) return;
    setPending(true);
    try {
      if (await postAction(`/payables/${payableId}/dismiss-duplicate`)) router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <button onClick={dismiss} disabled={pending} className="app-button-primary">
      {pending ? "Descartando…" : "No es duplicado"}
    </button>
  );
}

/** PO_AMOUNT_MISMATCH: Procurement enmienda la PO al monto real facturado. */
export function AmendPoButton({ payableId }: { payableId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function amend() {
    if (!window.confirm("¿Enmendar la PO para que coincida con el monto facturado?")) return;
    setPending(true);
    try {
      if (await postAction(`/payables/${payableId}/amend-po`)) router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <button onClick={amend} disabled={pending} className="app-button-primary">
      {pending ? "Enmendando…" : "Enmendar PO"}
    </button>
  );
}
