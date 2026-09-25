"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { PipelineStepper } from "@/components/PipelineStepper";
import type { Summary } from "@/lib/api";

type FlowState = "idle" | "uploading" | "processing" | "done";

const PROCESSING_STEPS = [
  "Leyendo el archivo",
  "Normalizando al Canonical Payable Model",
  "Aplicando las 8 reglas del kernel",
  "Generando resultados",
];

export function IntakeFlow({ summary }: { summary: Summary }) {
  const DONE_STEPS = [
    {
      label: "Intake",
      detail: `${summary.payableCount} filas leídas`,
      href: "/",
      state: "done" as const,
    },
    {
      label: "Verificación",
      detail: "8 reglas del kernel",
      href: "/payables",
      state: "done" as const,
    },
    {
      label: "Exceptions",
      detail: `${summary.blockedCount} bloqueados`,
      href: "/exceptions",
      state: "active" as const,
    },
    {
      label: "Proof-of-Payable",
      detail: `${summary.readyCount} listo`,
      href: "/proof-of-payable",
      state: "next" as const,
    },
  ];

  const [state, setState] = useState<FlowState>("idle");
  const [fileName, setFileName] = useState("");
  const [progress, setProgress] = useState(0);
  const [stepIndex, setStepIndex] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function startFlow(name: string) {
    setFileName(name);
    setState("uploading");
    setProgress(0);

    const uploadInterval = setInterval(() => {
      setProgress((p) => {
        if (p >= 100) {
          clearInterval(uploadInterval);
          setState("processing");
          runProcessing();
          return 100;
        }
        return p + 8;
      });
    }, 60);
  }

  function runProcessing() {
    setStepIndex(0);
    PROCESSING_STEPS.forEach((_, i) => {
      setTimeout(
        () => {
          setStepIndex(i + 1);
          if (i === PROCESSING_STEPS.length - 1) {
            setTimeout(() => setState("done"), 400);
          }
        },
        500 + i * 550,
      );
    });
  }

  function reset() {
    setState("idle");
    setFileName("");
    setProgress(0);
    setStepIndex(0);
  }

  return (
    <div className="flex flex-col gap-6">
      {state === "idle" && (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const file = e.dataTransfer.files[0];
            if (file) startFlow(file.name);
          }}
          onClick={() => inputRef.current?.click()}
          className={`cursor-pointer rounded-3xl bg-surface p-10 text-center shadow-[var(--shadow)] transition-colors ${
            dragOver ? "ring-2 ring-accent/40" : ""
          }`}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.csv"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) startFlow(file.name);
            }}
          />
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-ready-bg text-ready">
            <ArrowUpIcon />
          </div>
          <p className="text-sm font-medium">Arrastrá tu Excel/CSV acá o hacé click para elegir un archivo</p>
          <p className="mt-1 text-xs text-muted">PDF y email — próximamente</p>

          <div className="mt-6 flex items-center justify-center gap-2">
            <SourcePill label="Excel / CSV" active />
            <SourcePill label="PDF" />
            <SourcePill label="Email" />
          </div>
        </div>
      )}

      {state === "uploading" && (
        <div className="rounded-3xl bg-surface p-10 shadow-[var(--shadow)]">
          <div className="mb-4 flex items-center justify-between">
            <p className="text-sm font-medium">Subiendo {fileName}</p>
            <span className="text-xs text-muted">{Math.min(progress, 100)}%</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-background">
            <div
              className="h-full rounded-full bg-accent transition-all duration-100"
              style={{ width: `${Math.min(progress, 100)}%` }}
            />
          </div>
        </div>
      )}

      {state === "processing" && (
        <div className="rounded-3xl bg-surface p-10 shadow-[var(--shadow)]">
          <p className="mb-5 text-sm font-medium">Procesando {fileName}</p>
          <div className="flex flex-col gap-3.5">
            {PROCESSING_STEPS.map((label, i) => {
              const status = i < stepIndex ? "done" : i === stepIndex ? "active" : "pending";
              return (
                <div key={label} className="flex items-center gap-3">
                  {status === "done" && (
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-ready text-[10px] text-white">
                      ✓
                    </span>
                  )}
                  {status === "active" && (
                    <span className="h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-accent/25 border-t-accent" />
                  )}
                  {status === "pending" && (
                    <span className="h-5 w-5 shrink-0 rounded-full bg-background" />
                  )}
                  <span
                    className={`text-sm ${status === "pending" ? "text-muted" : "text-foreground"}`}
                  >
                    {label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {state === "done" && (
        <>
          <div className="rounded-3xl bg-surface p-8 shadow-[var(--shadow)]">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">{fileName}</p>
                <p className="text-xs text-muted">
                  {summary.payableCount} invoices · {summary.totalRequested} USDC solicitado
                </p>
              </div>
              <span className="rounded-full bg-ready-bg px-2.5 py-1 text-xs font-medium text-ready">
                Procesado
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-2xl bg-ready-bg p-4">
                <p className="text-xs text-ready">Ready</p>
                <p className="mt-1 font-mono text-lg font-medium text-ready">
                  {summary.totalReady} USDC
                </p>
              </div>
              <div className="rounded-2xl bg-blocked-bg p-4">
                <p className="text-xs text-blocked">Bloqueado</p>
                <p className="mt-1 font-mono text-lg font-medium text-blocked">
                  {summary.totalBlocked} USDC
                </p>
              </div>
            </div>

            <div className="mt-5 flex items-center gap-3">
              <Link
                href="/exceptions"
                className="rounded-full bg-accent px-4 py-2 text-xs font-medium text-accent-foreground shadow-[var(--shadow)] hover:opacity-90"
              >
                Ver Exceptions
              </Link>
              <button
                onClick={reset}
                className="rounded-full bg-background px-4 py-2 text-xs font-medium text-muted hover:text-foreground"
              >
                Cargar otro archivo
              </button>
            </div>

            <p className="mt-5 text-xs text-muted">
              Mockup: el resultado siempre es el fixture de 5 invoices, sin importar el archivo que
              subas — el AI Extraction Service real todavía no existe (Sprint 2).
            </p>
          </div>

          <div className="rounded-3xl bg-surface p-8 shadow-[var(--shadow)]">
            <PipelineStepper steps={DONE_STEPS} />
          </div>
        </>
      )}
    </div>
  );
}

function SourcePill({ label, active }: { label: string; active?: boolean }) {
  return (
    <span
      onClick={(e) => e.stopPropagation()}
      className={`rounded-full px-3 py-1 text-xs font-medium ${
        active ? "bg-ready-bg text-ready" : "bg-background text-muted"
      }`}
    >
      {label}
    </span>
  );
}

function ArrowUpIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 19V5M5 12l7-7 7 7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
