"use client";

import { useEffect, useState } from "react";
import { dismissToast, subscribeToasts, type Toast } from "@/lib/toast";

/**
 * Avisos dentro de la propia app — "un vendor salió de Resolución",
 * "settlement confirmado en Stellar", "reconciliación confirmada" — para
 * que la demo se sienta viva sin depender de un permiso del navegador.
 */
export function ToastStack() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => subscribeToasts(setToasts), []);

  if (toasts.length === 0) return null;

  return (
    <div className="toast-stack">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast-card toast-card-${toast.tone}`} role={toast.tone === "error" ? "alert" : "status"}>
          <button
            type="button"
            className="toast-dismiss"
            onClick={() => dismissToast(toast.id)}
            aria-label="Cerrar aviso"
          >
            ×
          </button>
          <p className="toast-title">{toast.title}</p>
          <p className="toast-body">{toast.body}</p>
        </div>
      ))}
    </div>
  );
}
