export const PIPELINE_STAGES = ["Intake", "Verificación", "Resolución", "Proof-of-Payable", "Settlement", "Reconciliación"] as const;

/**
 * Flujograma clickeable: cada nodo es la puerta de entrada a su propio
 * slide (`ControlRoomFlow` filtra el contenido de abajo según cuál esté
 * seleccionado). `activeIndex` sigue siendo el bottleneck real del batch
 * (un solo punto pulsando); `viewIndex` es, aparte, qué slide se está
 * mirando ahora mismo — pueden no coincidir si el usuario navegó a mano.
 */
export function PipelineOverview({
  activeIndex,
  viewIndex,
  finished = false,
  onSelect,
}: {
  activeIndex: number;
  viewIndex: number;
  finished?: boolean;
  onSelect: (index: number) => void;
}) {
  return (
    <div className="pipeline-strip">
      {PIPELINE_STAGES.map((label, i) => {
        const kind = i < activeIndex || (finished && i === activeIndex) ? "done" : i === activeIndex ? "active" : "idle";
        return (
          <button
            key={label}
            type="button"
            onClick={() => onSelect(i)}
            className={`pipeline-strip-node pipeline-strip-node-${kind} ${i === viewIndex ? "pipeline-strip-node-viewed" : ""}`}
          >
            <span className="pipeline-strip-line" aria-hidden />
            {/* `key={kind}` remonta el punto cuando pasa a "done" — eso es lo que dispara el pop, no una animación que corre siempre. */}
            <span key={kind} className={`pipeline-strip-dot ${kind === "done" ? "pipeline-strip-dot-pop" : ""}`} aria-hidden />
            <span className="pipeline-strip-label">{label}</span>
          </button>
        );
      })}
    </div>
  );
}
