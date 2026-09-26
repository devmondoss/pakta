const STAGES = ["Intake", "Verificación", "Resolución", "Proof-of-Payable", "Settlement", "Reconciliación"] as const;

/** UN solo flujograma minimalista: puntos + etiqueta, sin caja ni conteos. Un único nodo activo a la vez — el que refleja qué proceso corre ahora. */
export function PipelineOverview({ activeIndex, finished = false }: { activeIndex: number; finished?: boolean }) {
  return (
    <div className="pipeline-strip">
      {STAGES.map((label, i) => {
        const kind = i < activeIndex || (finished && i === activeIndex) ? "done" : i === activeIndex ? "active" : "idle";
        return (
          <div key={label} className={`pipeline-strip-node pipeline-strip-node-${kind}`}>
            <span className="pipeline-strip-line" aria-hidden />
            <span className="pipeline-strip-dot" aria-hidden />
            <span className="pipeline-strip-label">{label}</span>
          </div>
        );
      })}
    </div>
  );
}
