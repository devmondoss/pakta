"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { PromptDialog } from "@/components/PromptDialog";
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
  const [showPrompt, setShowPrompt] = useState(false);

  async function registerWallet(address: string) {
    setShowPrompt(false);
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
        onClick={() => setShowPrompt(true)}
        disabled={pending !== null}
        className="app-button-secondary"
      >
        {pending === "register" ? "Registrando…" : "Cambiar wallet"}
      </button>
      {showPrompt && (
        <PromptDialog
          title="Cambiar wallet"
          body={`Nueva wallet para ${vendorId} — el vendor la reclama, todavía sin confirmar.`}
          placeholder="G..."
          confirmLabel="Registrar"
          onSubmit={registerWallet}
          onCancel={() => setShowPrompt(false)}
        />
      )}
    </div>
  );
}
