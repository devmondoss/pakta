"use client";

import { useEffect, useState } from "react";
import { motion } from "motion/react";
import type { Payable } from "@/lib/api";

const STEPS = ["Conciliando con el ERP…", "Enviando correo de cierre…", "Cierre registrado"];

export function CompletionDialog({ payables, onDismiss }: { payables: Payable[]; onDismiss: () => void }) {
  const [step, setStep] = useState(0);
  const total = payables.reduce((sum, payable) => sum + Number(payable.amount), 0);

  useEffect(() => {
    const first = setTimeout(() => setStep(1), 850);
    const second = setTimeout(() => setStep(2), 1_850);
    return () => {
      clearTimeout(first);
      clearTimeout(second);
    };
  }, []);

  return (
    <motion.div className="stage-intro-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.div
        className="stage-intro-card completion-dialog"
        initial={{ opacity: 0, scale: 0.92, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 6 }}
        transition={{ type: "spring", stiffness: 340, damping: 26 }}
      >
        <p className="stage-intro-eyebrow">Ciclo completado</p>
        <p className="completion-dialog-title">Todo quedó liquidado, conciliado y registrado.</p>
        <div className="confirm-dialog-details">
          <div className="confirm-dialog-row"><span className="confirm-dialog-label">Pagos procesados</span><span className="confirm-dialog-value">{payables.length}</span></div>
          <div className="confirm-dialog-row"><span className="confirm-dialog-label">Total liquidado</span><span className="confirm-dialog-value">USD {total.toFixed(2)}</span></div>
          <div className="confirm-dialog-row"><span className="confirm-dialog-label">Red</span><span className="confirm-dialog-value">Stellar testnet</span></div>
        </div>
        <div className="completion-status" role="status">
          <span className={step < 2 ? "stage-working-dot" : "completion-check"} aria-hidden>{step === 2 ? "✓" : ""}</span>
          {STEPS[step]}
        </div>
        <p className="completion-note">La notificación es una simulación del demo; el registro queda trazado en la bitácora.</p>
        <button type="button" onClick={onDismiss} className="stage-intro-next" disabled={step < 2}>
          Ver resumen →
        </button>
      </motion.div>
    </motion.div>
  );
}
