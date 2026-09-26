"use client";

import { useState } from "react";

/** Reemplaza `window.prompt()` con el mismo estilo de overlay que `ConfirmDialog`/`StageIntro`, agregando un input de texto. */
export function PromptDialog({
  title,
  body,
  placeholder,
  confirmLabel = "Confirmar",
  cancelLabel = "Cancelar",
  onSubmit,
  onCancel,
}: {
  title: string;
  body: string;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState("");

  function submit() {
    const trimmed = value.trim();
    if (trimmed) onSubmit(trimmed);
  }

  return (
    <div className="stage-intro-backdrop" onClick={onCancel}>
      <div className="stage-intro-card" onClick={(e) => e.stopPropagation()}>
        <p className="stage-intro-eyebrow">{title}</p>
        <p className="stage-intro-body">{body}</p>
        <input
          autoFocus
          type="text"
          value={value}
          placeholder={placeholder}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          className="prompt-dialog-input"
        />
        <div className="confirm-dialog-actions">
          <button type="button" onClick={onCancel} className="app-button-secondary">
            {cancelLabel}
          </button>
          <button type="button" onClick={submit} disabled={!value.trim()} className="stage-intro-next">
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
