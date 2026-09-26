"use client";

import { useState } from "react";
import { Sparkles } from "lucide-react";

/**
 * Narración plegable de "cómo se llegó a esto" — puramente cosmética,
 * armada con `reasoningTrace()` a partir de datos que el kernel
 * determinístico ya calculó. Rotulada explícitamente para que nadie lea
 * esto como si un LLM estuviera decidiendo el pago: el kernel decide,
 * esto solo lo explica en lenguaje llano.
 */
export function ReasoningTrace({ steps }: { steps: string[] }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="reasoning-trace">
      <button type="button" onClick={() => setOpen((v) => !v)} className="reasoning-trace-toggle">
        <Sparkles size={13} strokeWidth={2.2} />
        <span>{open ? "Ocultar" : "Ver"} cómo se interpretó</span>
      </button>
      {open && (
        <div className="reasoning-trace-body">
          <p className="reasoning-trace-disclaimer">
            Lectura simplificada del resultado del kernel determinístico — no es quien decide el pago.
          </p>
          <ol className="reasoning-trace-list">
            {steps.map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
