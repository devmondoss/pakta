"use client";

import { useEffect } from "react";

const AUTO_DISMISS_MS = 5000;

/**
 * Overlay centrado que explica la etapa a la que se acaba de entrar — el
 * contenido del slide ya está montado detrás, esto solo se superpone
 * mientras el usuario lee. Se cierra solo (`AUTO_DISMISS_MS`) o con
 * "Siguiente"; cualquiera de las dos formas sigue el flujo.
 */
export function StageIntro({ title, body, onDismiss }: { title: string; body: string; onDismiss: () => void }) {
  useEffect(() => {
    const id = setTimeout(onDismiss, AUTO_DISMISS_MS);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, body]);

  return (
    <div className="stage-intro-backdrop" onClick={onDismiss}>
      <div className="stage-intro-card" onClick={(e) => e.stopPropagation()}>
        <div className="stage-intro-progress">
          <div className="stage-intro-progress-bar" style={{ animationDuration: `${AUTO_DISMISS_MS}ms` }} />
        </div>
        <p className="stage-intro-eyebrow">{title}</p>
        <p className="stage-intro-body">{body}</p>
        <button type="button" onClick={onDismiss} className="stage-intro-next">
          Siguiente →
        </button>
      </div>
    </div>
  );
}
