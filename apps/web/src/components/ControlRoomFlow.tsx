"use client";

import { useEffect, useRef, useState } from "react";
import type { Payable, Vendor } from "@/lib/api";
import { IntakeFlow } from "@/components/IntakeFlow";
import { IntakeHistory } from "@/components/IntakeHistory";
import { PayablesBoard } from "@/components/PayablesBoard";
import { PipelineOverview } from "@/components/PipelineOverview";
import { StageIntro } from "@/components/StageIntro";
import { ToastStack } from "@/components/ToastStack";

type IntakePhase = "idle" | "processing" | "done" | "error";

/** Qué explicar al entrar a cada etapa — un overlay centrado, no un toast de esquina: la demo necesita que esto se lea antes de seguir, no que pase desapercibido. */
function stageIntroCopy(stage: number, payables: Payable[]): { title: string; body: string } | null {
  const count = (status: Payable["status"]) => payables.filter((p) => p.status === status).length;
  switch (stage) {
    case 1:
      return { title: "Verificación", body: `Evaluando ${payables.length} payable(s) contra las 8 reglas del kernel.` };
    case 2: {
      const blocked = count("BLOCKED");
      return blocked > 0
        ? { title: "Resolución", body: `${blocked} excepción(es) encontradas — necesitan que alguien actúe.` }
        : { title: "Resolución", body: "Sin excepciones pendientes en este batch." };
    }
    case 3:
      return { title: "Proof-of-Payable", body: `${count("READY")} payable(s) con proof calculado — proveedor, wallet y monto verificados.` };
    case 4:
      return { title: "Settlement", body: `${count("READY")} payable(s) listos para liquidar en Stellar.` };
    case 5:
      return { title: "Reconciliación", body: `${count("SETTLED")} settlement(s) esperando confirmación del ERP.` };
    default:
      return null;
  }
}

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
  // vista camina una etapa a la vez, mostrando un overlay que explica esa
  // etapa hasta que el usuario lo cierra (o se cierra solo a los 5s) antes
  // de seguir a la próxima.
  const [viewIndex, setViewIndex] = useState(0);
  const [pinned, setPinned] = useState(false);
  const [introStage, setIntroStage] = useState<number | null>(null);
  // Ref, no state: no necesitamos re-renderizar cuando el poll trae un
  // array nuevo (misma info, otra referencia) — solo el valor más fresco
  // de `payables` en el instante en que se entra a una etapa.
  const payablesRef = useRef(payables);
  payablesRef.current = payables;

  // Entrar a una etapa explica qué hay ahí — sea porque el tour avanzó
  // solo o porque el usuario clickeó un nodo a mano. Cualquiera de las dos
  // formas de llegar dispara el mismo overlay.
  function goToStage(i: number) {
    setViewIndex(i);
    setIntroStage(stageIntroCopy(i, payablesRef.current) ? i : null);
  }

  useEffect(() => {
    if (pinned || introStage !== null || viewIndex === index) return;
    const next = viewIndex < index ? viewIndex + 1 : index;
    goToStage(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, pinned, viewIndex, introStage]);

  function selectStage(i: number) {
    setPinned(true);
    goToStage(i);
  }

  function handlePhaseChange(nextPhase: IntakePhase, stage?: 0 | 1) {
    if (nextPhase !== "idle") setHasActed(true);
    setPhase(nextPhase);
    if (stage !== undefined) setProcessingStage(stage);
  }

  const intro = introStage !== null ? stageIntroCopy(introStage, payablesRef.current) : null;

  return (
    <div className="flex flex-col gap-10">
      <ToastStack />
      {intro && <StageIntro title={intro.title} body={intro.body} onDismiss={() => setIntroStage(null)} />}
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
