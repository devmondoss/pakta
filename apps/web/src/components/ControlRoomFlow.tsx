"use client";

import { useState } from "react";
import type { Payable, Vendor } from "@/lib/api";
import { IntakeFlow } from "@/components/IntakeFlow";
import { IntakeHistory } from "@/components/IntakeHistory";
import { PayablesBoard } from "@/components/PayablesBoard";
import { PipelineOverview } from "@/components/PipelineOverview";
import { SummaryStrip } from "@/components/SummaryStrip";

type IntakePhase = "idle" | "processing" | "done" | "error";

/**
 * El bottleneck real del batch: el nodo más a la izquierda que todavía
 * tiene trabajo pendiente. Así el flujograma muestra un único paso
 * "encendido" — el que de verdad se está ejecutando ahora — en vez de
 * un conteo por etapa.
 *
 * Solo se consulta una vez que esta sesión hizo algo (`hasActed`) —
 * mientras nadie tocó nada, mostrar el bottleneck de datos que ya
 * estaban en la base (de una sesión anterior) contradice lo que la
 * pantalla de Intake, vacía, está mostrando ahora mismo.
 */
function computeStage(
  phase: IntakePhase,
  processingStage: 0 | 1,
  payables: Payable[],
  hasActed: boolean,
): { index: number; finished: boolean } {
  if (!hasActed) return { index: 0, finished: false }; // nada hecho en esta sesión todavía

  // Mientras el Intake anima sus propios sub-pasos, el macro se queda en
  // Intake (0) o salta a Verificación (1) según cuál mitad esté mostrando
  // — nunca en un tercer valor inventado.
  if (phase === "processing") return { index: processingStage, finished: false };
  if (payables.length === 0) return { index: 0, finished: false }; // nada cargado todavía

  if (payables.some((p) => p.status === "BLOCKED")) return { index: 2, finished: false };
  // El proof ya está calculado en cuanto el payable es READY (se deriva
  // en vivo, no es un paso que quede pendiente por su cuenta) — lo que
  // falta de verdad es el settlement.
  if (payables.some((p) => p.status === "READY")) return { index: 4, finished: false };
  if (payables.some((p) => p.status === "SETTLED" && p.settlement?.erpPostingStatus !== "RECONCILED")) {
    return { index: 5, finished: false };
  }
  return { index: 5, finished: true }; // todo settled y reconciliado
}

export function ControlRoomFlow({
  initialPayables,
  vendors,
}: {
  initialPayables: Payable[];
  vendors: Vendor[];
}) {
  const [phase, setPhase] = useState<IntakePhase>("idle");
  const [processingStage, setProcessingStage] = useState<0 | 1>(0);
  const [payables, setPayables] = useState(initialPayables);
  const [hasActed, setHasActed] = useState(false);
  const { index, finished } = computeStage(phase, processingStage, payables, hasActed);

  function handlePhaseChange(nextPhase: IntakePhase, stage?: 0 | 1) {
    if (nextPhase !== "idle") setHasActed(true);
    setPhase(nextPhase);
    if (stage !== undefined) setProcessingStage(stage);
  }

  return (
    <div className="flex flex-col gap-10">
      <PipelineOverview activeIndex={index} finished={finished} />
      {hasActed && <SummaryStrip payables={payables} />}
      <div className="control-panel p-3 sm:p-4">
        <IntakeFlow onPhaseChange={handlePhaseChange} />
      </div>
      {!hasActed && <IntakeHistory />}
      {hasActed && (
        <div id="resultados">
          <PayablesBoard initialPayables={initialPayables} vendors={vendors} onPayablesChange={setPayables} />
        </div>
      )}
    </div>
  );
}
