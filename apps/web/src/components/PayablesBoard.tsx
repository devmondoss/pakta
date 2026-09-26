"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Payable, Vendor } from "@/lib/api";
import { OnChainPanel } from "@/components/OnChainPanel";
import { PayableCard, type PayableCardFocus } from "@/components/PayableCard";
import { StatusBadge } from "@/components/StatusBadge";
import { postAction } from "@/lib/postAction";
import { pushToast } from "@/lib/toast";
import { blockedNarrative, reasonLabel } from "@/lib/reasoning";

const AUTO_SETTLE_DELAY_MS = 1500;
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

/**
 * Avisa solo las transiciones que de verdad mueven la aguja del pipeline —
 * nunca en la carga inicial (`prev` vacío no cuenta como transición).
 * Devuelve si hubo al menos una transición real, para que quien llama
 * pueda reaccionar (el tour se "despierta" y sigue el progreso de nuevo,
 * en vez de quedarse mirando una lista que se vació sin explicación).
 */
function notifyTransitions(prev: Payable[], next: Payable[]): boolean {
  const prevById = new Map(prev.map((p) => [p.payableId, p]));
  let changed = false;
  for (const p of next) {
    const before = prevById.get(p.payableId);
    if (!before) continue;
    const who = `${p.vendorName} (${p.invoiceId})`;
    if (before.status === "BLOCKED" && p.status !== "BLOCKED") {
      const cause = before.exception ? ` — se resolvió: ${reasonLabel(before.exception.reason)}.` : ".";
      pushToast("Excepción resuelta", `${who} salió de Resolución${cause}`);
      changed = true;
    }
    if (before.status !== "SETTLED" && p.status === "SETTLED") {
      pushToast("Settlement confirmado", `${who} se liquidó en Stellar por USD ${p.amount}.`);
      changed = true;
    }
    if (before.settlement?.erpPostingStatus === "PENDING" && p.settlement?.erpPostingStatus === "RECONCILED") {
      pushToast("Reconciliación confirmada", `${who} quedó reconciliado con el ERP — ciclo cerrado.`);
      changed = true;
    }
  }
  return changed;
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
  onProgress,
}: {
  initialPayables: Payable[];
  vendors: Vendor[];
  stage: number;
  onPayablesChange?: (payables: Payable[]) => void;
  /** Se llama cuando una acción (propia o de otra pestaña) de verdad movió algo — quien escucha usa esto para volver a seguir el progreso real. */
  onProgress?: () => void;
}) {
  const router = useRouter();
  const [payables, setPayables] = useState(initialPayables);
  const [settlementEnabled, setSettlementEnabled] = useState(false);
  const payablesRef = useRef(payables);
  // El disparador automático solo puede tener una liquidación en vuelo. La
  // cuenta ejecutora de Stellar tiene secuencia estricta: el siguiente pago
  // espera a que la red responda por el anterior.
  const autoSettleInFlightRef = useRef(false);
  const autoSettleStartedAtRef = useRef<number | null>(null);
  const autoSettleAttemptedRef = useRef<Set<string>>(new Set());
  const autoSettlementPausedRef = useRef(false);
  useEffect(() => {
    payablesRef.current = payables;
  }, [payables]);
  useEffect(() => {
    const readyIds = new Set(initialPayables.filter((payable) => payable.status === "READY").map((payable) => payable.payableId));
    for (const payableId of autoSettleAttemptedRef.current) {
      if (!readyIds.has(payableId)) autoSettleAttemptedRef.current.delete(payableId);
    }
    if (autoSettleAttemptedRef.current.size === 0) autoSettlementPausedRef.current = false;
    if (notifyTransitions(payablesRef.current, initialPayables)) onProgress?.();
    setPayables(initialPayables);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPayables]);
  // El flujograma global vive fuera de este componente — le avisamos cada
  // vez que cambia la lista (carga inicial y cada poll) en vez de que lea
  // el estado interno del board.
  useEffect(() => onPayablesChange?.(payables), [payables, onPayablesChange]);
  const vendorById = new Map(vendors.map((v) => [v.vendorId, v]));

  // Repregunta cada 6s en vez de una sola vez al montar — si esta pestaña
  // ya estaba abierta antes de que el settlement se prendiera/apagara del
  // lado del server, un chequeo único la dejaba con el estado viejo para
  // siempre, sin ninguna forma de enterarse del cambio.
  useEffect(() => {
    let active = true;
    async function checkHealth() {
      try {
        const res = await fetch(`${API_URL}/health`, { cache: "no-store" });
        if (active && res.ok) setSettlementEnabled((await res.json()).settlement === "enabled");
      } catch {
        // API momentarily unreachable — keep showing the last known state.
      }
    }
    checkHealth();
    const id = setInterval(checkHealth, 6000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  // Settlement sigue siendo automático, pero nunca en ráfaga: elegimos el
  // primer READY, esperamos un breve beat visual y solo entonces lo enviamos.
  // Al terminar, el poll refleja el nuevo estado y recién ahí se toma el
  // siguiente. Así no se reutiliza en paralelo la secuencia de la cuenta
  // ejecutora ni aparece TRY_AGAIN_LATER.
  useEffect(() => {
    if (stage !== 4 || !settlementEnabled) {
      autoSettleStartedAtRef.current = null;
      return;
    }

    const id = setInterval(() => {
      if (autoSettleInFlightRef.current || autoSettlementPausedRef.current) return;
      const next = payablesRef.current.find(
        (payable) => payable.status === "READY" && !autoSettleAttemptedRef.current.has(payable.payableId),
      );
      if (!next) {
        autoSettleStartedAtRef.current = null;
        return;
      }

      const now = Date.now();
      if (autoSettleStartedAtRef.current === null) {
        autoSettleStartedAtRef.current = now;
        return;
      }
      if (now - autoSettleStartedAtRef.current < AUTO_SETTLE_DELAY_MS) return;

      autoSettleInFlightRef.current = true;
      autoSettleStartedAtRef.current = null;
      // Un rechazo de testnet no se reintenta a ciegas cada pocos segundos.
      autoSettleAttemptedRef.current.add(next.payableId);
      postAction(`/payables/${encodeURIComponent(next.payableId)}/settle`)
        .then((ok) => {
          if (ok) {
            router.refresh();
            return;
          }
          autoSettlementPausedRef.current = true;
        })
        .finally(() => {
          autoSettleInFlightRef.current = false;
        });
    }, 300);

    return () => clearInterval(id);
  }, [stage, settlementEnabled, router]);

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
          if (notifyTransitions(payablesRef.current, next)) onProgress?.();
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (stage === 1) {
    return (
      <div key={stage} className="pipeline-slide pipeline-slide-enter">
        <p className="pipeline-slide-heading">Verificación · {payables.length} payables evaluados</p>
        {payables.length === 0 ? (
          <p className="payable-column-empty">Nada evaluado todavía.</p>
        ) : (
          <div className="verification-list">
            {payables.map((p, i) => (
              <div key={p.payableId} className="verification-row stage-item-enter" style={{ animationDelay: `${i * 60}ms` }}>
                <div className="verification-row-top">
                  <span className="verification-vendor truncate">{p.vendorName}</span>
                  <span className="verification-id truncate">
                    {p.invoiceId} · USD {p.amount}
                  </span>
                  <StatusBadge status={p.status} />
                </div>
                <p className="verification-reason">
                  {p.exception ? blockedNarrative(p) : "Factura, PO y receipt coinciden — proveedor y wallet verificados."}
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
  const reconciled = stage === 5 ? items.filter((p) => p.settlement?.erpPostingStatus === "RECONCILED") : [];
  const pendingReconciliation = stage === 5 ? items.filter((p) => p.settlement?.erpPostingStatus !== "RECONCILED") : [];
  // Solo en Proof-of-Payable: además de las que SÍ tienen proof, mostrar
  // caso por caso por qué las bloqueadas todavía no lo tienen — el
  // contraste completa la etapa en vez de dejarla solo con el lado
  // positivo.
  const blocked = stage === 3 ? payables.filter((p) => p.status === "BLOCKED") : [];

  return (
    <div key={stage} className="pipeline-slide pipeline-slide-enter">
      <p className="pipeline-slide-heading">
        {config.heading} · {items.length}
      </p>
      {(stage === 4 || stage === 5) && <OnChainPanel />}
      {stage === 5 && items.length > 0 && (
        <p className={`settlement-progress ${pendingReconciliation.length === 0 ? "settlement-progress-complete" : ""}`} role="status">
          {pendingReconciliation.length === 0
            ? `${reconciled.length} pago(s) liquidado(s) y conciliado(s). El ciclo de settlement está cerrado.`
            : `${reconciled.length} pago(s) conciliado(s) · ${pendingReconciliation.length} esperando confirmación del ERP.`}
        </p>
      )}
      {items.length === 0 ? (
        <p className="payable-column-empty">{config.empty}</p>
      ) : (
        <div className="pipeline-slide-list">
          {items.map((payable, i) => (
            <div key={payable.payableId} className="stage-item-enter" style={{ animationDelay: `${i * 90}ms` }}>
              <PayableCard
                payable={payable}
                vendor={vendorById.get(payable.vendorId)}
                settlementEnabled={settlementEnabled}
                focus={config.focus}
                collapsible={false}
              />
            </div>
          ))}
        </div>
      )}
      {blocked.length > 0 && (
        <div className="no-proof-section">
          <p className="no-proof-heading">Todavía sin proof · {blocked.length}</p>
          <div className="verification-list">
            {blocked.map((p, i) => (
              <div key={p.payableId} className="verification-row stage-item-enter" style={{ animationDelay: `${i * 60}ms` }}>
                <div className="verification-row-top">
                  <span className="verification-vendor truncate">{p.vendorName}</span>
                  <span className="verification-id truncate">
                    {p.invoiceId} · USD {p.amount}
                  </span>
                  <StatusBadge status={p.status} />
                </div>
                <p className="verification-reason">{blockedNarrative(p)}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
