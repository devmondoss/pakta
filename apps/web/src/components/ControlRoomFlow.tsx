"use client";

import { useEffect, useState } from "react";
import type { Payable, Vendor } from "@/lib/api";
import { IntakeFlow } from "@/components/IntakeFlow";
import { IntakeHistory } from "@/components/IntakeHistory";
import { PayablesBoard } from "@/components/PayablesBoard";
import { PipelineOverview } from "@/components/PipelineOverview";
import { ToastStack } from "@/components/ToastStack";

type IntakePhase = "idle" | "processing" | "done" | "error";

// Resolución trae varias tarjetas de excepción para leer — se queda más
// tiempo en pantalla que un paso que es solo una lista o un botón.
const TOUR_STEP_MS: Record<number, number> = { 1: 1800, 2: 3600, 3: 2200, 4: 2200, 5: 1400 };

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

  // Cada nodo del pipeline es su propio slide — `viewIndex` es cuál se está
  // mirando ahora. Mientras el usuario no toque nada (`pinned === false`),
  // el slide sigue el progreso real solo; en cuanto hace click en un nodo
  // toma el control manual, como en una presentación.
  //
  // El progreso real puede saltar varias etapas de una sola vez — un batch
  // recién cargado ya puede traer un payable READY o incluso SETTLED, así
  // que `index` salta directo ahí. Si `viewIndex` copiara ese salto tal
  // cual, Resolución (con las razones de cada bloqueo) ni se llegaría a
  // ver: aparecería y desaparecería en el mismo render. En vez de eso, la
  // vista camina una etapa a la vez con una pausa, como si cada paso
  // realmente tomara su tiempo.
  const [viewIndex, setViewIndex] = useState(0);
  const [pinned, setPinned] = useState(false);
  useEffect(() => {
    if (pinned || viewIndex === index) return;
    const next = viewIndex < index ? viewIndex + 1 : index;
    const id = setTimeout(() => setViewIndex(next), TOUR_STEP_MS[next] ?? 1400);
    return () => clearTimeout(id);
  }, [index, pinned, viewIndex]);

  function selectStage(i: number) {
    setPinned(true);
    setViewIndex(i);
  }

  function handlePhaseChange(nextPhase: IntakePhase, stage?: 0 | 1) {
    if (nextPhase !== "idle") setHasActed(true);
    setPhase(nextPhase);
    if (stage !== undefined) setProcessingStage(stage);
  }

  return (
    <div className="flex flex-col gap-10">
      <ToastStack />
      <PipelineOverview activeIndex={index} viewIndex={viewIndex} finished={finished} onSelect={selectStage} />

      <div className={viewIndex === 0 ? "flex flex-col gap-6" : "hidden"}>
        <div className="control-panel p-3 sm:p-4">
          <IntakeFlow onPhaseChange={handlePhaseChange} />
        </div>
        <IntakeHistory />
      </div>

      {hasActed && (
        <div id="resultados" className={viewIndex === 0 ? "hidden" : ""}>
          <PayablesBoard initialPayables={initialPayables} vendors={vendors} stage={viewIndex} onPayablesChange={setPayables} />
        </div>
      )}
    </div>
  );
}
