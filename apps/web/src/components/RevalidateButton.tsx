"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { postAction } from "@/lib/postAction";

export function RevalidateButton({ payableId }: { payableId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function revalidate() {
    setPending(true);
    try {
      if (await postAction(`/payables/${payableId}/revalidate`)) router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <button
      onClick={revalidate}
      disabled={pending}
      className="app-button-secondary"
    >
      {pending ? "Revalidando…" : "Revalidar"}
    </button>
  );
}
