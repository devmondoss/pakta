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
      className="rounded-full bg-background px-2.5 py-1 text-xs font-medium text-muted hover:text-foreground disabled:opacity-50"
    >
      {pending ? "Revalidando…" : "Revalidar"}
    </button>
  );
}
