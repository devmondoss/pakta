"use client";

import { useEffect, useState } from "react";
import type { Payable, Vendor } from "@/lib/api";
import { PayableCard } from "@/components/PayableCard";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export function PayablesBoard({ initialPayables, vendors }: { initialPayables: Payable[]; vendors: Vendor[] }) {
  const [payables, setPayables] = useState(initialPayables);
  const [settlementEnabled, setSettlementEnabled] = useState(false);
  // `router.refresh()` after an action re-renders the page with fresh
  // props; without this the board kept showing stale state until the
  // next 4 s poll, so a click looked like it did nothing.
  useEffect(() => setPayables(initialPayables), [initialPayables]);
  const vendorById = new Map(vendors.map((v) => [v.vendorId, v]));

  useEffect(() => {
    fetch(`${API_URL}/health`, { cache: "no-store" })
      .then((res) => res.ok ? res.json() : Promise.reject())
      .then((health) => setSettlementEnabled(health.settlement === "enabled"))
      .catch(() => setSettlementEnabled(false));
  }, []);

  // Polls independently of navigation — a resolved exception (or a
  // settlement Dev 1 reports) shows up here on its own, without anyone
  // needing to refresh the page.
  useEffect(() => {
    let active = true;
    const id = setInterval(async () => {
      try {
        const res = await fetch(`${API_URL}/payables`, { cache: "no-store" });
        if (active && res.ok) setPayables(await res.json());
      } catch {
        // API momentarily unreachable — keep showing the last known state.
      }
    }, 4000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  const blocked = payables.filter((p) => p.status === "BLOCKED").length;
  const ready = payables.filter((p) => p.status === "READY").length;
  const settled = payables.filter((p) => p.status === "SETTLED").length;

  return (
    <div>
      <div className="mb-4 flex items-center gap-5 text-sm text-muted">
        <span>{payables.length} payables</span>
        {blocked > 0 && <span className="text-live">{blocked} con excepción</span>}
        {ready > 0 && <span className="text-ready">{ready} listos</span>}
        {settled > 0 && <span className="text-settled">{settled} liquidados</span>}
      </div>
      <div className="flex flex-col gap-2">
        {payables.map((payable) => (
          <PayableCard
            key={payable.payableId}
            payable={payable}
            vendor={vendorById.get(payable.vendorId)}
            settlementEnabled={settlementEnabled}
          />
        ))}
      </div>
    </div>
  );
}
