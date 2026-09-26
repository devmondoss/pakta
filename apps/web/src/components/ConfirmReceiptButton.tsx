"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export function ConfirmReceiptButton({ payableId }: { payableId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function confirm() {
    setPending(true);
    try {
      await fetch(`${API_URL}/payables/${payableId}/receipt`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmedBy: "ops@pakta.demo" }),
      });
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <button
      onClick={confirm}
      disabled={pending}
      className="rounded-full bg-accent px-2.5 py-1 text-xs font-medium text-accent-foreground hover:opacity-90 disabled:opacity-50"
    >
      {pending ? "Confirmando…" : "Confirmar recepción"}
    </button>
  );
}
