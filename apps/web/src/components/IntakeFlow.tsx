"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

type FlowState = "idle" | "processing" | "done" | "error";

const WORKBOOK_STEPS = [
  "Leyendo el archivo",
  "Normalizando al Canonical Payable Model",
  "Aplicando las 8 reglas del kernel",
  "Generando resultados",
];

const PDF_STEPS = [
  "Extrayendo el texto del PDF",
  "La IA lee la factura",
  "Validando contra proveedores y POs registrados",
  "Generando resultados",
];

type ExtractedField = { value: string; confidence: number; sourceExcerpt: string };

type IngestResult =
  | { kind: "workbook"; ingested: number; rejectedRows: { sheet: string; rowNumber: number; errors: string[] }[] }
  | {
      kind: "pdf";
      status: "CANDIDATE" | "NEEDS_REVIEW";
      payableId?: string;
      reason?: string;
      extraction: Record<string, ExtractedField | undefined>;
    };

const EXTRACTED_LABELS: [key: string, label: string][] = [
  ["vendorName", "Proveedor"],
  ["invoiceId", "Factura"],
  ["amount", "Monto"],
  ["dueDate", "Vence"],
  ["poReference", "PO"],
  ["walletAddress", "Wallet"],
];

/** Mirrors `resolveExtraction`'s default threshold in @pakta/ai-extraction. */
const MIN_CONFIDENCE = 0.7;

function isPdfFile(file: File) {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function IntakeFlow() {
  const router = useRouter();
  const [state, setState] = useState<FlowState>("idle");
  const [fileName, setFileName] = useState("");
  const [steps, setSteps] = useState(WORKBOOK_STEPS);
  const [stepIndex, setStepIndex] = useState(0);
  const [result, setResult] = useState<IngestResult | null>(null);
  const [error, setError] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function ingest(file: File) {
    const pdf = isPdfFile(file);
    if (!pdf && !file.name.toLowerCase().endsWith(".xlsx")) {
      setFileName(file.name);
      setError("Formato no soportado. Subí un workbook .xlsx o una factura .pdf.");
      setState("error");
      return;
    }

    const flowSteps = pdf ? PDF_STEPS : WORKBOOK_STEPS;
    setSteps(flowSteps);
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
      for (let i = 0; i < flowSteps.length - 1; i++) {
        await wait(350);
        setStepIndex(i + 1);
      }
    })();

    const request = fetch(`${API_URL}/ingest`, { method: "POST", body: formData })
      .then(async (res) => {
        if (res.status === 413) throw new Error("El archivo supera el límite de 20 MB.");
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error ?? `La API respondió ${res.status}`);
        return body as IngestResult;
      });

    try {
      const [, outcome] = await Promise.all([
        revealSteps,
        request.catch((err: Error) => {
          // fetch() rejects with a bare TypeError when the API is down —
          // say that instead of "Failed to fetch".
          throw err instanceof TypeError ? new Error("No se pudo conectar con la API. ¿Está corriendo en el puerto 4000?") : err;
        }),
      ]);
      setStepIndex(flowSteps.length);
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
            accept=".xlsx,.pdf"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) ingest(file);
            }}
          />
          <p className="text-sm text-muted">
            Arrastrá un workbook o una factura acá, o{" "}
            <span className="text-foreground underline underline-offset-2">elegí un archivo</span>
          </p>
          <p className="mt-1 text-xs text-muted/70">.xlsx con VENDORS, PO, INVOICES, RECEIPTS, APPROVALS · .pdf de una factura (lectura con IA)</p>
        </div>
      )}

      {state === "processing" && (
        <div className="rounded-3xl bg-surface p-8">
          <div className="flex flex-col gap-3">
            {steps.map((label, i) => {
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

      {state === "done" && result?.kind === "pdf" && (
        <div className="rounded-3xl bg-surface p-6">
          <div className="flex items-start justify-between gap-4">
            <p className="text-sm">
              {result.status === "CANDIDATE" ? (
                <>
                  <span className="text-ready">Listo.</span> {fileName} — la IA leyó la factura y coincide con un
                  proveedor y PO registrados. Quedó cargada como {result.payableId}.
                </>
              ) : (
                <>
                  <span className="text-live">Requiere revisión.</span> {fileName} — la IA leyó la factura, pero no
                  se cargó: {result.reason}
                </>
              )}
            </p>
            <button onClick={reset} className="shrink-0 text-xs text-muted hover:text-foreground">
              Cargar otro
            </button>
          </div>
          <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-2 border-t border-border/60 pt-4 text-xs sm:grid-cols-2">
            {EXTRACTED_LABELS.map(([key, label]) => {
              const field = result.extraction[key];
              if (!field) return null;
              // Below the guardrail's threshold the value is ignored by the
              // backend — show it as such instead of as if it were real data.
              const trusted = field.confidence >= MIN_CONFIDENCE;
              return (
                <div key={key} className="flex items-baseline justify-between gap-3">
                  <dt className="text-muted">{label}</dt>
                  <dd
                    className={`truncate font-mono ${trusted ? "text-foreground" : "text-muted line-through"}`}
                    title={field.sourceExcerpt}
                  >
                    {field.value}{" "}
                    <span className={trusted ? "text-muted" : "text-live no-underline"}>
                      · {Math.round(field.confidence * 100)}%{trusted ? "" : " — descartado"}
                    </span>
                  </dd>
                </div>
              );
            })}
          </dl>
        </div>
      )}

      {state === "done" && result?.kind === "workbook" && (
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
