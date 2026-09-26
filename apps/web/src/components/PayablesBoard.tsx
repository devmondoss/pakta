"use client";

import { useEffect, useState } from "react";
import type { Payable, Vendor } from "@/lib/api";
import { PayableCard } from "@/components/PayableCard";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

const COLUMNS = [
  { status: "READY", label: "Ready", kind: "ready" },
  { status: "BLOCKED", label: "Bloqueado", kind: "blocked" },
  { status: "SETTLED", label: "Settled", kind: "settled" },
] as const;

export function PayablesBoard({
  initialPayables,
  vendors,
  onPayablesChange,
}: {
  initialPayables: Payable[];
  vendors: Vendor[];
  onPayablesChange?: (payables: Payable[]) => void;
}) {
  const [payables, setPayables] = useState(initialPayables);
  const [settlementEnabled, setSettlementEnabled] = useState(false);
  // `router.refresh()` after an action re-renders the page with fresh
  // props; without this the board kept showing stale state until the
  // next 4 s poll, so a click looked like it did nothing.
  useEffect(() => setPayables(initialPayables), [initialPayables]);
  // El flujograma global vive fuera de este componente — le avisamos cada
  // vez que cambia la lista (carga inicial y cada poll) en vez de que lea
  // el estado interno del board.
  useEffect(() => onPayablesChange?.(payables), [payables, onPayablesChange]);
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

  return (
    <div className="payable-board">
      {COLUMNS.map((column) => {
        const items = payables.filter((p) => p.status === column.status);
        return (
          <div key={column.status} className={`payable-column payable-column-${column.kind}`}>
            <div className="payable-column-heading">
              <span>{column.label}</span>
              <span className="payable-column-count">{items.length}</span>
            </div>
            <div className="payable-column-list">
              {items.length === 0 ? (
                <p className="payable-column-empty">Nada acá todavía.</p>
              ) : (
                items.map((payable) => (
                  <PayableCard
                    key={payable.payableId}
                    payable={payable}
                    vendor={vendorById.get(payable.vendorId)}
                    settlementEnabled={settlementEnabled}
                  />
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
