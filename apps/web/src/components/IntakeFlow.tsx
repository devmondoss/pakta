"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

type FlowState = "idle" | "processing" | "done" | "error";

const PROCESSING_STEPS = [
  "Leyendo el archivo",
  "Normalizando al Canonical Payable Model",
  "Aplicando las 8 reglas del kernel",
  "Generando resultados",
];

type IngestResult = { ingested: number; rejectedRows: { sheet: string; rowNumber: number; errors: string[] }[] };

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function IntakeFlow() {
  const router = useRouter();
  const [state, setState] = useState<FlowState>("idle");
  const [fileName, setFileName] = useState("");
  const [stepIndex, setStepIndex] = useState(0);
  const [result, setResult] = useState<IngestResult | null>(null);
  const [error, setError] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function ingest(file: File) {
    setFileName(file.name);
    setState("processing");
    setStepIndex(0);
    setError("");

    const formData = new FormData();
    formData.append("file", file);

    // The step reveal is real-time-shaped (each step gets a minimum
    // on-screen moment so it's readable), but the *result* it ends on is
    // whatever the actual /ingest response says — never canned.
    const revealSteps = (async () => {
      for (let i = 0; i < PROCESSING_STEPS.length - 1; i++) {
        await wait(350);
        setStepIndex(i + 1);
      }
    })();

    const request = fetch(`${API_URL}/ingest`, { method: "POST", body: formData })
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
        return body as IngestResult;
      });

    try {
      const [, outcome] = await Promise.all([revealSteps, request]);
      setStepIndex(PROCESSING_STEPS.length);
      await wait(300);
      setResult(outcome);
      setState("done");
      router.refresh();
      document.getElementById("resultados")?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (err) {
      setError((err as Error).message);
      setState("error");
    }
  }

  function reset() {
    setState("idle");
    setFileName("");
    setStepIndex(0);
    setResult(null);
    setError("");
  }

  return (
    <div>
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
            if (file) ingest(file);
          }}
          onClick={() => inputRef.current?.click()}
          className={`cursor-pointer rounded-3xl border border-dashed p-10 text-center transition-colors ${
            dragOver ? "border-accent bg-accent/5" : "border-border hover:border-muted"
          }`}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) ingest(file);
            }}
          />
          <p className="text-sm text-muted">
            Arrastrá un workbook acá, o{" "}
            <span className="text-foreground underline underline-offset-2">elegí uno</span>
          </p>
          <p className="mt-1 text-xs text-muted/70">.xlsx — VENDORS, PO, INVOICES, RECEIPTS, APPROVALS</p>
        </div>
      )}

      {state === "processing" && (
        <div className="rounded-3xl bg-surface p-8">
          <div className="flex flex-col gap-3">
            {PROCESSING_STEPS.map((label, i) => {
              const status = i < stepIndex ? "done" : i === stepIndex ? "active" : "pending";
              return (
                <div key={label} className="flex items-center gap-3">
                  {status === "done" && <span className="h-1.5 w-1.5 rounded-full bg-ready" />}
                  {status === "active" && (
                    <span className="h-3 w-3 animate-spin rounded-full border-2 border-accent/25 border-t-accent" />
                  )}
                  {status === "pending" && <span className="h-1.5 w-1.5 rounded-full bg-border" />}
                  <span className={`text-sm ${status === "pending" ? "text-muted" : "text-foreground"}`}>{label}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {state === "done" && result && (
        <div className="rounded-3xl bg-surface p-6">
          <div className="flex items-center justify-between">
            <p className="text-sm">
              <span className="text-ready">Listo.</span> {fileName} — {result.ingested} payables ingestados de verdad,
              persistidos en la base.
            </p>
            <button onClick={reset} className="shrink-0 text-xs text-muted hover:text-foreground">
              Cargar otro
            </button>
          </div>
          {result.rejectedRows.length > 0 && (
            <div className="mt-3 flex flex-col gap-1 border-t border-border/60 pt-3 text-xs text-blocked">
              {result.rejectedRows.map((row, i) => (
                <span key={i}>
                  {row.sheet} fila {row.rowNumber}: {row.errors.join(", ")}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {state === "error" && (
        <div className="flex items-center justify-between rounded-3xl bg-surface p-6">
          <p className="text-sm text-blocked">{error}</p>
          <button onClick={reset} className="shrink-0 text-xs text-muted hover:text-foreground">
            Reintentar
          </button>
        </div>
      )}
    </div>
  );
}
