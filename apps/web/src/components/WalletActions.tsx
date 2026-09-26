"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { postAction } from "@/lib/postAction";

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
      if (await postAction(`/vendors/${vendorId}/wallet`, { address })) router.refresh();
    } finally {
      setPending(null);
    }
  }

  async function attestWallet() {
    setPending("attest");
    try {
      if (await postAction(`/vendors/${vendorId}/wallet/attest`)) router.refresh();
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
          className="app-button-primary"
        >
          {pending === "attest" ? "Atestiguando…" : "Atestiguar"}
        </button>
      )}
      <button
        onClick={registerWallet}
        disabled={pending !== null}
        className="app-button-secondary"
      >
        {pending === "register" ? "Registrando…" : "Cambiar wallet"}
      </button>
    </div>
  );
}
