"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export function WalletActions({
  vendorId,
  attestationStatus,
}: {
  vendorId: string;
  attestationStatus: "ATTESTED" | "UNATTESTED" | undefined;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<"register" | "attest" | null>(null);

  async function registerWallet() {
    const address = window.prompt(`Nueva wallet para ${vendorId} (el vendor la reclama, todavía sin confirmar):`);
    if (!address) return;

    setPending("register");
    try {
      await fetch(`${API_URL}/vendors/${vendorId}/wallet`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address }),
      });
      router.refresh();
    } finally {
      setPending(null);
    }
  }

  async function attestWallet() {
    setPending("attest");
    try {
      await fetch(`${API_URL}/vendors/${vendorId}/wallet/attest`, { method: "POST" });
      router.refresh();
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {attestationStatus === "UNATTESTED" && (
        <button
          onClick={attestWallet}
          disabled={pending !== null}
          className="rounded-full bg-accent px-2.5 py-1 text-xs font-medium text-accent-foreground hover:opacity-90 disabled:opacity-50"
        >
          {pending === "attest" ? "Atestiguando…" : "Atestiguar"}
        </button>
      )}
      <button
        onClick={registerWallet}
        disabled={pending !== null}
        className="rounded-full bg-background px-2.5 py-1 text-xs font-medium text-muted hover:text-foreground disabled:opacity-50"
      >
        {pending === "register" ? "Registrando…" : "Cambiar wallet"}
      </button>
    </div>
  );
}
