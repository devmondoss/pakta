"use client";

import { useEffect, useRef, useState } from "react";
import type { Payable, Vendor } from "@/lib/api";
import { PayableCard, type PayableCardFocus } from "@/components/PayableCard";
import { StatusBadge } from "@/components/StatusBadge";
import { pushToast } from "@/lib/toast";
import { reasonLabel } from "@/lib/reasoning";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

/** Avisa solo las transiciones que de verdad mueven la aguja del pipeline — nunca en la carga inicial (`prev` vacío no cuenta como transición). */
function notifyTransitions(prev: Payable[], next: Payable[]) {
  const prevById = new Map(prev.map((p) => [p.payableId, p]));
  for (const p of next) {
    const before = prevById.get(p.payableId);
    if (!before) continue;
    const who = `${p.vendorName} (${p.invoiceId})`;
    if (before.status === "BLOCKED" && p.status !== "BLOCKED") {
      const cause = before.exception ? ` — se resolvió: ${reasonLabel(before.exception.reason)}.` : ".";
      pushToast("Excepción resuelta", `${who} salió de Resolución${cause}`);
    }
    if (before.status !== "SETTLED" && p.status === "SETTLED") {
      pushToast("Settlement confirmado", `${who} se liquidó en Stellar por USD ${p.amount}.`);
    }
    if (before.settlement?.erpPostingStatus === "PENDING" && p.settlement?.erpPostingStatus === "RECONCILED") {
      pushToast("Reconciliación confirmada", `${who} quedó reconciliado con el ERP — ciclo cerrado.`);
    }
  }
}

/** Un slide por etapa — cada una filtra a SOLO los payables que le corresponden, con el foco de tarjeta que le sirve a esa etapa nada más. */
const STAGE_CONFIG: Record<
  number,
  { status: Payable["status"]; heading: string; empty: string; focus: PayableCardFocus }
> = {
  2: { status: "BLOCKED", heading: "Resolución", empty: "No hay excepciones pendientes — todo lo bloqueado ya se resolvió.", focus: "exception" },
  3: { status: "READY", heading: "Proof-of-Payable", empty: "Nada listo todavía — resolvé las excepciones primero.", focus: "proof" },
  4: { status: "READY", heading: "Settlement", empty: "Nada listo para liquidar todavía.", focus: "settle" },
  5: { status: "SETTLED", heading: "Reconciliación", empty: "Todavía no hay nada liquidado en Stellar.", focus: "reconcile" },
};

export function PayablesBoard({
  initialPayables,
  vendors,
  stage,
  onPayablesChange,
}: {
  initialPayables: Payable[];
  vendors: Vendor[];
  stage: number;
  onPayablesChange?: (payables: Payable[]) => void;
}) {
  const [payables, setPayables] = useState(initialPayables);
  const [settlementEnabled, setSettlementEnabled] = useState(false);
  const payablesRef = useRef(payables);
  useEffect(() => {
    payablesRef.current = payables;
  }, [payables]);
  // `router.refresh()` after an action re-renders the page with fresh
  // props; without this the board kept showing stale state until the
  // next 4 s poll, so a click looked like it did nothing.
  useEffect(() => {
    notifyTransitions(payablesRef.current, initialPayables);
    setPayables(initialPayables);
  }, [initialPayables]);
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
  // needing to refresh the page. Corre siempre, sin importar qué slide se
  // esté mirando, para que las otras etapas ya tengan datos frescos apenas
  // el usuario navega hacia ellas.
  useEffect(() => {
    let active = true;
    const id = setInterval(async () => {
      try {
        const res = await fetch(`${API_URL}/payables`, { cache: "no-store" });
        if (active && res.ok) {
          const next: Payable[] = await res.json();
          notifyTransitions(payablesRef.current, next);
          setPayables(next);
        }
      } catch {
        // API momentarily unreachable — keep showing the last known state.
      }
    }, 4000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  if (stage === 1) {
    return (
      <div className="pipeline-slide">
        <p className="pipeline-slide-heading">Verificación · {payables.length} payables evaluados</p>
        {payables.length === 0 ? (
          <p className="payable-column-empty">Nada evaluado todavía.</p>
        ) : (
          <div className="verification-list">
            {payables.map((p) => (
              <div key={p.payableId} className="verification-row">
                <div className="verification-row-top">
                  <span className="verification-vendor truncate">{p.vendorName}</span>
                  <span className="verification-id truncate">
                    {p.invoiceId} · USD {p.amount}
                  </span>
                  <StatusBadge status={p.status} />
                </div>
                <p className="verification-reason">
                  {p.exception ? `${reasonLabel(p.exception.reason)} — responsable: ${p.exception.ownerRole}` : "Factura, PO y receipt coinciden — proveedor y wallet verificados."}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  const config = STAGE_CONFIG[stage];
  if (!config) return null;

  const items = payables.filter((p) => p.status === config.status);

  return (
    <div className="pipeline-slide">
      <p className="pipeline-slide-heading">
        {config.heading} · {items.length}
      </p>
      {items.length === 0 ? (
        <p className="payable-column-empty">{config.empty}</p>
      ) : (
        <div className="pipeline-slide-list">
          {items.map((payable) => (
            <PayableCard
              key={payable.payableId}
              payable={payable}
              vendor={vendorById.get(payable.vendorId)}
              settlementEnabled={settlementEnabled}
              focus={config.focus}
              collapsible={false}
            />
          ))}
        </div>
      )}
    </div>
  );
}
