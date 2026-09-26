"use client";

/**
 * Reemplaza `window.confirm()` — mismo patrón visual que `StageIntro`
 * (overlay centrado, tarjeta papel-y-tinta), pero para decisiones que el
 * usuario dispara con un click, no pasos automáticos del pipeline.
 */
export function ConfirmDialog({
  title,
  body,
  details,
  confirmLabel = "Confirmar",
  cancelLabel = "Cancelar",
  onConfirm,
  onCancel,
}: {
  title: string;
  body: string;
  details?: { label: string; value: string }[];
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="stage-intro-backdrop" onClick={onCancel}>
      <div className="stage-intro-card" onClick={(e) => e.stopPropagation()}>
        <p className="stage-intro-eyebrow">{title}</p>
        {details && details.length > 0 && (
          <div className="confirm-dialog-details">
            {details.map((d) => (
              <div key={d.label} className="confirm-dialog-row">
                <span className="confirm-dialog-label">{d.label}</span>
                <span className="confirm-dialog-value">{d.value}</span>
              </div>
            ))}
          </div>
        )}
        <p className="stage-intro-body">{body}</p>
        <div className="confirm-dialog-actions">
          <button type="button" onClick={onCancel} className="app-button-secondary">
            {cancelLabel}
          </button>
          <button type="button" onClick={onConfirm} className="stage-intro-next">
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
