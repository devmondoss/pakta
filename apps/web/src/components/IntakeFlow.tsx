"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { PlayCircle } from "lucide-react";

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
  | {
      kind: "workbook";
      ingested: number;
      rejectedRows: { sheet: string; rowNumber: number; errors: string[] }[];
      /** Solo presente cuando vino de "Probar con un caso real" (`POST /demo/reset`), no de un upload real. */
      variantLabel?: string;
      invoices?: { invoiceId: string; vendorName: string; amount: string }[];
    }
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

export function IntakeFlow({
  onPhaseChange,
}: {
  /**
   * `stage` solo importa mientras `phase === "processing"`: los primeros
   * pasos ("Leyendo el archivo"/"Extrayendo texto") todavía son trabajo de
   * Intake (0); los últimos ("Aplicando las 8 reglas"/"Validando…") ya son
   * Verificación (1) — así el flujograma macro se enciende en el nodo
   * correcto en vez de saltar directo a Verificación apenas se suelta el
   * archivo.
   */
  onPhaseChange?: (phase: FlowState, stage?: 0 | 1) => void;
}) {
  const router = useRouter();
  const [state, setState] = useState<FlowState>("idle");
  const [fileName, setFileName] = useState("");
  const [steps, setSteps] = useState(WORKBOOK_STEPS);
  const [stepIndex, setStepIndex] = useState(0);
  const [result, setResult] = useState<IngestResult | null>(null);
  const [error, setError] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [showVariants, setShowVariants] = useState(false);
  const [variants, setVariants] = useState<{ index: number; label: string }[] | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Se piden solo al abrir el picker por primera vez, no en cada render
  // — el mismo patrón que `PolicyInfo` usa para `/policy`.
  useEffect(() => {
    if (!showVariants || variants) return;
    fetch(`${API_URL}/demo/variants`)
      .then((res) => res.json())
      .then(setVariants)
      .catch(() => {});
  }, [showVariants, variants]);

  // El flujograma global (arriba de la página) necesita saber si hay una
  // ingesta en curso, y en qué mitad de los pasos — se lo reportamos, no
  // lo duplicamos acá.
  useEffect(() => {
    const stage = stepIndex < Math.ceil(steps.length / 2) ? 0 : 1;
    onPhaseChange?.(state, state === "processing" ? stage : undefined);
  }, [state, stepIndex, steps.length, onPhaseChange]);

  /**
   * Corre la animación de pasos (WORKBOOK_STEPS/PDF_STEPS) mientras espera
   * el resultado real de `requestFn` — nunca al revés. Compartido por
   * `ingest()` (archivo real) y `loadDemoData()` (reset + seed del backend)
   * para no duplicar el manejo de estado/errores entre los dos caminos.
   */
  async function runIngest(flowSteps: string[], label: string, requestFn: () => Promise<IngestResult>) {
    setSteps(flowSteps);
    setFileName(label);
    setState("processing");
    setStepIndex(0);
    setError("");

    // Cada paso se queda visible un rato — la demo existe para enseñar que
    // hay verificaciones corriendo, así que no puede resolverse de un
    // parpadeo aunque la API real responda en milisegundos.
    const revealSteps = (async () => {
      for (let i = 0; i < flowSteps.length - 1; i++) {
        await wait(1300);
        setStepIndex(i + 1);
      }
    })();

    try {
      const [, outcome] = await Promise.all([
        revealSteps,
        requestFn().catch((err: Error) => {
          // fetch() rejects with a bare TypeError when the API is down —
          // say that instead of "Failed to fetch".
          throw err instanceof TypeError ? new Error("No se pudo conectar con la API. ¿Está corriendo en el puerto 4000?") : err;
        }),
      ]);
      setStepIndex(flowSteps.length);
      await wait(1000);
      setResult(outcome);
      setState("done");
      router.refresh();
      document.getElementById("resultados")?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (err) {
      setError((err as Error).message);
      setState("error");
    }
  }

  /**
   * No re-sube ningún archivo: pide al backend que wipee la DB y reseede
   * la variante elegida por el usuario en el picker (`POST /demo/reset`
   * con `variantIndex`), incluyendo el hecho externo (fingerprint previo
   * de INV-002) que un simple re-upload del xlsx no puede reproducir. Así
   * el batch siempre reproduce el 1 READY + 4 BLOCKED canónico, sin
   * importar qué haya quedado de un ensayo anterior o de una factura real
   * con datos insuficientes.
   */
  async function loadDemoData(variantIndex: number) {
    await runIngest(WORKBOOK_STEPS, "Caso de prueba", async () => {
      const res = await fetch(`${API_URL}/demo/reset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ variantIndex }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `La API respondió ${res.status}`);
      return body as IngestResult;
    });
  }

  async function ingest(file: File) {
    const pdf = isPdfFile(file);
    if (!pdf && !file.name.toLowerCase().endsWith(".xlsx")) {
      setFileName(file.name);
      setError("Formato no soportado. Subí un workbook .xlsx o una factura .pdf.");
      setState("error");
      return;
    }

    const formData = new FormData();
    formData.append("file", file);

    await runIngest(pdf ? PDF_STEPS : WORKBOOK_STEPS, file.name, async () => {
      const res = await fetch(`${API_URL}/ingest`, { method: "POST", body: formData });
      if (res.status === 413) throw new Error("El archivo supera el límite de 20 MB.");
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `La API respondió ${res.status}`);
      return body as IngestResult;
    });
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
          className={`intake-dropzone cursor-pointer ${dragOver ? "intake-dropzone-active" : ""}`}
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
          <div>
            <p>Arrastrá un workbook o una factura acá, o <mark>elegí un archivo</mark></p>
            <p className="mt-1 font-mono text-[10px]">.xlsx con VENDORS, PO, INVOICES, RECEIPTS, APPROVALS · .pdf de una factura (lectura con IA)</p>
          </div>
        </div>
      )}

      {state === "idle" && (
        <div className="relative mt-3 flex items-center justify-center">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setShowVariants((v) => !v);
            }}
            className="app-button-secondary inline-flex items-center gap-1.5"
          >
            <PlayCircle size={15} strokeWidth={2.2} />
            Probar con un caso real
          </button>

          {showVariants && (
            <div
              className="policy-popover absolute top-9 z-20 w-64 p-2"
              onClick={(e) => e.stopPropagation()}
            >
              {!variants ? (
                <p className="p-2 text-xs text-muted">Cargando casos…</p>
              ) : (
                <div className="demo-variant-list">
                  <p className="demo-variant-heading">Elegí una industria</p>
                  {variants.map((v) => (
                    <button
                      key={v.index}
                      type="button"
                      className="demo-variant-option"
                      onClick={() => {
                        setShowVariants(false);
                        loadDemoData(v.index);
                      }}
                    >
                      {v.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {state === "processing" && (
        <div className="intake-state">
          <div className="flex flex-col gap-3">
            {steps.map((label, i) => {
              const status = i < stepIndex ? "done" : i === stepIndex ? "active" : "pending";
              return (
                <div key={label} className={`intake-state-row ${status === "pending" ? "text-muted" : "text-foreground"}`}>
                  {status === "done" && <span className="intake-state-marker intake-state-marker-done" />}
                  {status === "active" && (
                    <span className="h-3 w-3 animate-spin rounded-full border-2 border-accent/25 border-t-accent" />
                  )}
                  {status === "pending" && <span className="intake-state-marker intake-state-marker-pending" />}
                  <span>{label}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {state === "done" && result?.kind === "pdf" && (
        <div className="intake-state">
          <div className="intake-result-head">
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
            <button onClick={reset} className="intake-reset shrink-0">
              Cargar otro
            </button>
          </div>
          <dl className="intake-fields grid grid-cols-1 gap-x-6 gap-y-2 text-xs sm:grid-cols-2">
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
        <div className="intake-state">
          <div className="intake-result-head">
            <p className="text-sm">
              <span className="text-ready">Listo.</span>{" "}
              {result.variantLabel ? `Caso — ${result.variantLabel}` : fileName} — {result.ingested}{" "}
              payables ingestados de verdad, persistidos en la base.
            </p>
            <button onClick={reset} className="intake-reset shrink-0">
              Cargar otro
            </button>
          </div>
          {result.invoices && (
            <div className="intake-invoice-preview">
              {result.invoices.map((inv, i) => (
                <div
                  key={inv.invoiceId}
                  className="intake-invoice-row intake-invoice-row-enter"
                  style={{ animationDelay: `${i * 90}ms` }}
                >
                  <span className="intake-invoice-id">{inv.invoiceId}</span>
                  <span className="intake-invoice-vendor">{inv.vendorName}</span>
                  <span className="intake-invoice-amount">{inv.amount}</span>
                </div>
              ))}
            </div>
          )}
          {result.rejectedRows.length > 0 && (
            <div className="intake-fields flex flex-col gap-1 text-xs text-blocked">
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
        <div className="intake-state intake-result-head">
          <p className="text-sm text-blocked">{error}</p>
          <button onClick={reset} className="intake-reset shrink-0">
            Reintentar
          </button>
        </div>
      )}
    </div>
  );
}
