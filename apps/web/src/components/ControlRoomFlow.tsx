"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence } from "motion/react";
import type { Payable, Vendor } from "@/lib/api";
import { IntakeFlow } from "@/components/IntakeFlow";
import { IntakeHistory } from "@/components/IntakeHistory";
import { CompletionDialog } from "@/components/CompletionDialog";
import { PayablesBoard } from "@/components/PayablesBoard";
import { PIPELINE_STAGES, PipelineOverview } from "@/components/PipelineOverview";
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
    case 5: {
      const settled = payables.filter((p) => p.status === "SETTLED");
      const reconciled = settled.filter((p) => p.settlement?.erpPostingStatus === "RECONCILED");
      return reconciled.length === settled.length && settled.length > 0
        ? { title: "Reconciliación", body: `${reconciled.length} pago(s) se liquidaron y se conciliaron con el ERP. Ciclo cerrado.` }
        : { title: "Reconciliación", body: `${settled.length} settlement(s) esperando confirmación del ERP.` };
    }
    default:
      return null;
  }
}

/**
 * El nodo que se enciende muestra el siguiente trabajo pendiente del lote.
 * Settlement conserva prioridad mientras exista un payable READY; solo al
 * vaciar esa cola se pasa a Reconciliación. Un batch real procesa varios
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

  // Un settlement ya confirmado no debe adelantar el tablero a
  // Reconciliación si todavía hay otros payables READY. El worker automático
  // vive en Settlement (etapa 4), por lo que saltar a 5 tras el primer pago
  // dejaba el lote a medias y el resumen mostraba solo ese primer importe.
  const hasReady = payables.some((p) => p.status === "READY");
  const hasSettled = payables.some((p) => p.status === "SETTLED");
  const hasBlocked = payables.some((p) => p.status === "BLOCKED");
  const index = hasReady ? 4 : hasSettled ? 5 : hasBlocked ? 2 : 1;
  // Las excepciones bloqueadas permanecen en Resolución hasta que un humano
  // actúe. No deben impedir que el carril de settlement cierre para los
  // payables que sí llegaron a estar listos y ya fueron conciliados.
  const settlementCandidates = payables.filter((p) => p.status !== "BLOCKED");
  const finished =
    settlementCandidates.length > 0 &&
    settlementCandidates.every((p) => p.status === "SETTLED" && p.settlement?.erpPostingStatus === "RECONCILED");
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
  const [showCompletion, setShowCompletion] = useState(false);
  const completionShownRef = useRef(false);
  const sessionStartSettlementsRef = useRef<Set<string>>(new Set());
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
  // vista camina una etapa a la vez: entra, se queda `WORK_MS` mostrando
  // el slide solo (como si esa etapa estuviera corriendo de verdad), y
  // recién ahí aparece el overlay resumiendo qué pasó — nunca apenas se
  // entra, o los resúmenes salen todos pegados uno atrás del otro.
  const WORK_MS = 3400;
  const [viewIndex, setViewIndex] = useState(0);
  const [pinned, setPinned] = useState(false);
  const [working, setWorking] = useState(false);
  const [introStage, setIntroStage] = useState<number | null>(null);
  // Refs, no state: no necesitamos re-renderizar cuando el poll trae un
  // array nuevo (misma info, otra referencia), ni cuando guardamos el id
  // del timeout de "trabajo" en curso para poder cancelarlo.
  const payablesRef = useRef(payables);
  payablesRef.current = payables;
  const workTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Entrar a una etapa la muestra de una, pero el resumen (`introStage`)
  // aparece recién cuando termina el trabajo simulado — sea porque el
  // tour avanzó solo o porque el usuario clickeó un nodo a mano.
  function goToStage(i: number) {
    if (workTimeoutRef.current) clearTimeout(workTimeoutRef.current);
    setViewIndex(i);
    setIntroStage(null);
    const hasIntro = stageIntroCopy(i, payablesRef.current) !== null;
    setWorking(hasIntro);
    if (hasIntro) {
      workTimeoutRef.current = setTimeout(() => {
        setWorking(false);
        setIntroStage(i);
      }, WORK_MS);
    }
  }

  useEffect(() => {
    if (pinned || working || introStage !== null || viewIndex === index) return;
    const next = viewIndex < index ? viewIndex + 1 : index;
    goToStage(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, pinned, viewIndex, working, introStage]);

  function selectStage(i: number) {
    setPinned(true);
    goToStage(i);
  }

  function handlePhaseChange(nextPhase: IntakePhase, stage?: 0 | 1) {
    if (nextPhase === "processing") {
      sessionStartSettlementsRef.current = new Set(
        payablesRef.current.filter((payable) => payable.status === "SETTLED").map((payable) => payable.payableId),
      );
      completionShownRef.current = false;
      setShowCompletion(false);
    }
    if (nextPhase !== "idle") setHasActed(true);
    setPhase(nextPhase);
    if (stage !== undefined) setProcessingStage(stage);
  }

  const intro = introStage !== null ? stageIntroCopy(introStage, payablesRef.current) : null;
  const sessionCandidates = payables.filter(
    (payable) => payable.status !== "BLOCKED" && !sessionStartSettlementsRef.current.has(payable.payableId),
  );
  const sessionSettled = sessionCandidates.filter((payable) => payable.status === "SETTLED");
  const sessionFinished =
    phase === "done" &&
    sessionCandidates.length > 0 &&
    sessionCandidates.every((payable) => payable.status === "SETTLED" && payable.settlement?.erpPostingStatus === "RECONCILED");

  useEffect(() => {
    if (!hasActed || !sessionFinished || completionShownRef.current) return;
    completionShownRef.current = true;
    setShowCompletion(true);
  }, [hasActed, sessionFinished]);

  return (
    <div className="flex flex-col gap-10">
      <ToastStack />
      <AnimatePresence>
        {intro && <StageIntro key="stage-intro" title={intro.title} body={intro.body} onDismiss={() => setIntroStage(null)} />}
        {showCompletion && (
          <CompletionDialog
            key="completion-dialog"
            payables={sessionSettled}
            onDismiss={() => setShowCompletion(false)}
          />
        )}
      </AnimatePresence>
      {/* Mientras el tour camina solo, el punto pulsante sigue lo que se está narrando (`viewIndex`), no el progreso real crudo — si `index` salta adelante mientras el overlay todavía explica una etapa anterior, se ven dos "ahora" distintos a la vez. Una vez que el usuario toma el control (`pinned`), vuelve a mostrar el progreso real. */}
      <PipelineOverview activeIndex={pinned ? index : viewIndex} viewIndex={viewIndex} finished={finished} onSelect={selectStage} />
      {working && (
        <p className="stage-working">
          <span className="stage-working-dot" aria-hidden />
          Procesando {PIPELINE_STAGES[viewIndex]?.toLowerCase()}…
        </p>
      )}

      <div className={viewIndex === 0 ? "flex flex-col gap-6" : "hidden"}>
        <div className="control-panel p-3 sm:p-4">
          <IntakeFlow onPhaseChange={handlePhaseChange} />
        </div>
        <IntakeHistory />
      </div>

      {hasActed && (
        <div id="resultados" className={viewIndex === 0 ? "hidden" : ""}>
          <PayablesBoard
            initialPayables={initialPayables}
            vendors={vendors}
            stage={viewIndex}
            onPayablesChange={setPayables}
            onProgress={() => setPinned(false)}
          />
        </div>
      )}
    </div>
  );
}
