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

const AUTO_SETTLE_MS = 7500;

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
  // Cuándo se vio por primera vez cada payable READY en Settlement, y
  // cuáles ya dispararon su auto-settle — en refs, no en el array de
  // `payables` (que cambia de referencia en cada poll de 4s): si el timer
  // dependiera de `payables`, se reiniciaría antes de completar los 5s.
  const autoSettleFirstSeenRef = useRef<Map<string, number>>(new Map());
  const autoSettleFiredRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    payablesRef.current = payables;
  }, [payables]);
  // `router.refresh()` after an action re-renders the page with fresh
  // props; without this the board kept showing stale state until the
  // next 4 s poll, so a click looked like it did nothing.
  useEffect(() => {
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

  // Auto-settle: parado en Settlement, cada READY se liquida sola a los
  // 5s de aparecer — sin click, sin el diálogo de confirmación (ese es
  // solo para el disparo manual). Dispara la transacción real en Stellar.
  // Solo depende de [stage, settlementEnabled] — nunca de `payables`
  // (cambia de referencia en cada poll de 4s, y reiniciaría el conteo
  // antes de llegar a los 5s) — el scan usa `payablesRef.current`, que
  // siempre está al día sin forzar el efecto a reiniciar.
  useEffect(() => {
    if (stage !== 4 || !settlementEnabled) return;
    const id = setInterval(() => {
      const now = Date.now();
      for (const p of payablesRef.current) {
        if (p.status !== "READY" || autoSettleFiredRef.current.has(p.payableId)) continue;
        const firstSeen = autoSettleFirstSeenRef.current.get(p.payableId);
        if (firstSeen === undefined) {
          autoSettleFirstSeenRef.current.set(p.payableId, now);
        } else if (now - firstSeen >= AUTO_SETTLE_MS) {
          autoSettleFiredRef.current.add(p.payableId);
          postAction(`/payables/${encodeURIComponent(p.payableId)}/settle`).then((ok) => ok && router.refresh());
        }
      }
    }, 500);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, settlementEnabled]);

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
