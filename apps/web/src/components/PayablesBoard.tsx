"use client";

import { useEffect, useState } from "react";
import type { ActivityEntry, Payable, Vendor } from "@/lib/api";
import { ActivityLog } from "@/components/ActivityLog";
import { PayableCard } from "@/components/PayableCard";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export function PayablesBoard({
  initialPayables,
  vendors,
  activity,
  onPayablesChange,
}: {
  initialPayables: Payable[];
  vendors: Vendor[];
  activity: ActivityEntry[];
  onPayablesChange?: (payables: Payable[]) => void;
}) {
  const [payables, setPayables] = useState(initialPayables);
  const [activityEntries, setActivityEntries] = useState(activity);
  // `router.refresh()` after an action re-renders the page with fresh
  // props; without this the board kept showing stale state until the
  // next 4 s poll, so a click looked like it did nothing.
  useEffect(() => setPayables(initialPayables), [initialPayables]);
  useEffect(() => setActivityEntries(activity), [activity]);
  // El flujograma global vive fuera de este componente — le avisamos cada
  // vez que cambia la lista (carga inicial y cada poll) en vez de que lea
  // el estado interno del board.
  useEffect(() => onPayablesChange?.(payables), [payables, onPayablesChange]);
  const vendorById = new Map(vendors.map((v) => [v.vendorId, v]));

  // Polls independently of navigation — a resolved exception (or a
  // settlement Dev 1 reports) shows up here on its own, without anyone
  // needing to refresh the page. La actividad se pide junto con los
  // payables para que el log no se quede congelado entre refreshes.
  useEffect(() => {
    let active = true;
    const id = setInterval(async () => {
      try {
        const [payablesRes, activityRes] = await Promise.all([
          fetch(`${API_URL}/payables`, { cache: "no-store" }),
          fetch(`${API_URL}/activity`, { cache: "no-store" }),
        ]);
        if (active && payablesRes.ok) setPayables(await payablesRes.json());
        if (active && activityRes.ok) setActivityEntries(await activityRes.json());
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
    <div>
      <ActivityLog entries={activityEntries} />
      <div className="payable-list">
        {payables.map((payable) => (
          <PayableCard key={payable.payableId} payable={payable} vendor={vendorById.get(payable.vendorId)} />
        ))}
      </div>
    </div>
  );
}
