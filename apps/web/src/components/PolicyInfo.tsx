"use client";

import { useEffect, useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

type Policy = {
  policyVersion: string;
  rules: {
    require_po: boolean;
    require_receipt: boolean;
    amount_tolerance_pct: number;
    duplicate_detection: boolean;
    wallet_change_requires_human: boolean;
    auto_pay_below: string;
    second_approval_above: string;
  };
};

const LABELS: Record<keyof Policy["rules"], string> = {
  require_po: "Requiere PO",
  require_receipt: "Requiere recepción",
  amount_tolerance_pct: "Tolerancia de monto",
  duplicate_detection: "Detección de duplicados",
  wallet_change_requires_human: "Cambio de wallet requiere humano",
  auto_pay_below: "Auto-pago por debajo de",
  second_approval_above: "Doble aprobación por encima de",
};

export function PolicyInfo() {
  const [open, setOpen] = useState(false);
  const [policy, setPolicy] = useState<Policy | null>(null);

  useEffect(() => {
    if (!open || policy) return;
    fetch(`${API_URL}/policy`)
      .then((res) => res.json())
      .then(setPolicy)
      .catch(() => {});
  }, [open, policy]);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex h-6 w-6 items-center justify-center rounded-full text-xs text-muted hover:text-foreground"
        aria-label="Policy"
      >
        ⓘ
      </button>
      {open && (
        <div className="absolute right-0 top-8 z-20 w-72 rounded-2xl bg-surface p-4 shadow-[var(--shadow)]">
          {!policy ? (
            <p className="text-xs text-muted">Cargando…</p>
          ) : (
            <div className="flex flex-col gap-2">
              <p className="text-xs font-medium text-muted">Policy · {policy.policyVersion}</p>
              {Object.entries(policy.rules).map(([key, value]) => (
                <div key={key} className="flex items-center justify-between text-xs">
                  <span className="text-muted">{LABELS[key as keyof Policy["rules"]]}</span>
                  <span className="font-mono">{typeof value === "boolean" ? (value ? "Sí" : "No") : String(value)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
