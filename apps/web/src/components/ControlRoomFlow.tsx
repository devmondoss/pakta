"use client";

import { useState } from "react";
import type { Payable, Vendor } from "@/lib/api";
import { IntakeFlow } from "@/components/IntakeFlow";
import { IntakeHistory } from "@/components/IntakeHistory";
import { NotificationsToggle } from "@/components/NotificationsToggle";
import { PayablesBoard } from "@/components/PayablesBoard";
import { PipelineOverview } from "@/components/PipelineOverview";
import { SummaryStrip } from "@/components/SummaryStrip";

type IntakePhase = "idle" | "processing" | "done" | "error";

/** Qué tan lejos llegó un payable individual en el pipeline. */
function payableStage(p: Payable): number {
  if (p.status === "BLOCKED") return 2; // Resolución
  // El proof ya está calculado en cuanto el payable es READY (se deriva
  // en vivo, no es un paso que quede pendiente por su cuenta) — lo que
  // falta de verdad es el settlement.
  if (p.status === "READY") return 4;
  return 5; // SETTLED, reconciliado o no — de cualquier forma ya llegó al final del pipeline.
}

/**
 * El nodo que se enciende es el más avanzado que alcanzó CUALQUIER
 * payable del batch — no el más atrasado. Un batch real procesa varios
 * payables en paralelo: dos de las cuatro excepciones canónicas
 * (DUPLICATE_INVOICE, PO_AMOUNT_MISMATCH) no tienen ninguna acción de
 * resolución en esta UI, así que esos payables se quedan BLOCKED para
 * siempre. Si el pipeline exigiera que *todos* salgan de Resolución antes
 * de mostrar Proof-of-Payable/Settlement/Reconciliación, esas etapas
 * jamás se verían en la demo — quedaba atascado ahí sin ninguna salida.
 *
 * Solo se consulta una vez que esta sesión hizo algo (`hasActed`) —
 * mientras nadie tocó nada, mostrar el progreso de datos que ya estaban
 * en la base (de una sesión anterior) contradice lo que la pantalla de
 * Intake, vacía, está mostrando ahora mismo.
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

  const index = Math.max(...payables.map(payableStage));
  const finished = payables.every((p) => p.status === "SETTLED" && p.settlement?.erpPostingStatus === "RECONCILED");
  return { index, finished };
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
      {hasActed && (
        <div className="flex justify-end">
          <NotificationsToggle />
        </div>
      )}
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
