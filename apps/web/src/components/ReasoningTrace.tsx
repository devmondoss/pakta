"use client";

import { useState } from "react";
import { Sparkles } from "lucide-react";

/** Narración plegable de la evidencia y la política aplicadas al pago. */
export function ReasoningTrace({ steps }: { steps: string[] }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="reasoning-trace">
      <button type="button" onClick={() => setOpen((v) => !v)} className="reasoning-trace-toggle">
        <Sparkles size={13} strokeWidth={2.2} />
        <span>{open ? "Ocultar" : "Ver"} análisis de Pakta</span>
      </button>
      {open && (
        <div className="reasoning-trace-body">
          <p className="reasoning-trace-disclaimer">
            Cada decisión queda vinculada a la evidencia y la política aplicada.
          </p>
          <ol className="reasoning-trace-list">
            {steps.map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ol>
          <p className="reasoning-trace-engine">Trazabilidad verificable · evidencia + política + proof</p>
        </div>
      )}
    </div>
  );
}
