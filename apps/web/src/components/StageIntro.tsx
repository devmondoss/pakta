"use client";

import { useEffect } from "react";
import { motion } from "motion/react";

const AUTO_DISMISS_MS = 5000;

/**
 * Overlay centrado que explica la etapa a la que se acaba de entrar — el
 * contenido del slide ya está montado detrás, esto solo se superpone
 * mientras el usuario lee. Se cierra solo (`AUTO_DISMISS_MS`) o con
 * "Siguiente"; cualquiera de las dos formas sigue el flujo.
 *
 * `AnimatePresence` en el padre (`ControlRoomFlow`) es lo que le da salida
 * animada — este componente en sí siempre está "presente" mientras vive.
 */
export function StageIntro({ title, body, onDismiss }: { title: string; body: string; onDismiss: () => void }) {
  useEffect(() => {
    const id = setTimeout(onDismiss, AUTO_DISMISS_MS);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, body]);

  return (
    <motion.div
      className="stage-intro-backdrop"
      onClick={onDismiss}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
    >
      <motion.div
        className="stage-intro-card"
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.92, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 6 }}
        transition={{ type: "spring", stiffness: 340, damping: 26 }}
      >
        <div className="stage-intro-progress">
          <div className="stage-intro-progress-bar" style={{ animationDuration: `${AUTO_DISMISS_MS}ms` }} />
        </div>
        <p className="stage-intro-eyebrow">{title}</p>
        <p className="stage-intro-body">{body}</p>
        <button type="button" onClick={onDismiss} className="stage-intro-next">
          Siguiente →
        </button>
      </motion.div>
    </motion.div>
  );
}
