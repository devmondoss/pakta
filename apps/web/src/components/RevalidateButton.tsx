"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export function RevalidateButton({ payableId }: { payableId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function revalidate() {
    setPending(true);
    try {
      await fetch(`${API_URL}/payables/${payableId}/revalidate`, { method: "POST" });
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <button
      onClick={revalidate}
      disabled={pending}
      className="rounded-full bg-background px-2.5 py-1 text-xs font-medium text-muted hover:text-foreground disabled:opacity-50"
    >
      {pending ? "Revalidando…" : "Revalidar"}
    </button>
  );
}
