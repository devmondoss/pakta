"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { postAction } from "@/lib/postAction";

export function ConfirmReceiptButton({ payableId }: { payableId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function confirm() {
    setPending(true);
    try {
      if (await postAction(`/payables/${payableId}/receipt`, { confirmedBy: "ops@pakta.demo" })) router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <button
      onClick={confirm}
      disabled={pending}
      className="app-button-primary"
    >
      {pending ? "Confirmando…" : "Confirmar recepción"}
    </button>
  );
}
