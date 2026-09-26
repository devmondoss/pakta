"use client";

import { useEffect, useState } from "react";
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

type IngestResult = {
  kind: "workbook";
  ingested: number;
  rejectedRows: { sheet: string; rowNumber: number; errors: string[] }[];
  /** Siempre presente — este flujo solo carga datasets de prueba (`POST /demo/reset`), nunca un upload real. */
  variantLabel?: string;
  invoices?: { invoiceId: string; vendorName: string; amount: string }[];
};

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function IntakeFlow({
  onPhaseChange,
}: {
  /**
   * `stage` solo importa mientras `phase === "processing"`: los primeros
   * pasos ("Leyendo el archivo") todavía son trabajo de Intake (0); los
   * últimos ("Aplicando las 8 reglas") ya son Verificación (1) — así el
   * flujograma macro se enciende en el nodo correcto en vez de saltar
   * directo a Verificación apenas termina de cargar.
   */
  onPhaseChange?: (phase: FlowState, stage?: 0 | 1) => void;
}) {
  const router = useRouter();
  const [state, setState] = useState<FlowState>("idle");
  const [steps] = useState(WORKBOOK_STEPS);
  const [stepIndex, setStepIndex] = useState(0);
  const [result, setResult] = useState<IngestResult | null>(null);
  const [error, setError] = useState("");
  const [showVariants, setShowVariants] = useState(false);
  const [variants, setVariants] = useState<{ index: number; label: string }[] | null>(null);

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
   * No re-sube ningún archivo: pide al backend que wipee la DB y reseede
   * la variante elegida por el usuario en el picker (`POST /demo/reset`
   * con `variantIndex`), incluyendo el hecho externo (fingerprint previo
   * de INV-002) que un simple re-upload del xlsx no puede reproducir. Así
   * el batch siempre reproduce el 1 READY + 4 BLOCKED canónico, sin
   * importar qué haya quedado de un ensayo anterior.
   *
   * Cada paso se queda visible un rato — la demo existe para enseñar que
   * hay verificaciones corriendo, así que no puede resolverse de un
   * parpadeo aunque la API real responda en milisegundos.
   */
  async function loadDemoData(variantIndex: number) {
    setState("processing");
    setStepIndex(0);
    setError("");

    const revealSteps = (async () => {
      for (let i = 0; i < steps.length - 1; i++) {
        await wait(1300);
        setStepIndex(i + 1);
      }
    })();

    try {
      const [, outcome] = await Promise.all([
        revealSteps,
        (async () => {
          const res = await fetch(`${API_URL}/demo/reset`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ variantIndex }),
          });
          const body = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(body.error ?? `La API respondió ${res.status}`);
          return body as IngestResult;
        })().catch((err: Error) => {
          // fetch() rejects with a bare TypeError when the API is down —
          // say that instead of "Failed to fetch".
          throw err instanceof TypeError ? new Error("No se pudo conectar con la API. ¿Está corriendo en el puerto 4000?") : err;
        }),
      ]);
      setStepIndex(steps.length);
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

  function reset() {
    setState("idle");
    setStepIndex(0);
    setResult(null);
    setError("");
  }

  return (
    <div>
      {state === "idle" && (
        <div className="intake-primary">
          <p className="intake-primary-label">Fuente de datos</p>
          <div className="relative flex justify-center">
            <button type="button" onClick={() => setShowVariants((v) => !v)} className="intake-primary-cta">
              <PlayCircle size={18} strokeWidth={2.2} />
              Cargar dataset
            </button>

            {showVariants && (
              <div className="policy-popover absolute top-14 z-20 w-64 p-2" onClick={(e) => e.stopPropagation()}>
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
        </div>
      )}

      {state === "processing" && (
        <div className="intake-state">
          <div className="flex flex-col gap-3">
            {steps.map((label, i) => {
              const status = i < stepIndex ? "done" : i === stepIndex ? "active" : "pending";
              return (
                <div key={label} className="intake-state-item flex flex-col gap-1">
                  <div className={`intake-state-row ${status === "pending" ? "text-muted" : "text-foreground"}`}>
                    {status === "done" && <span className="intake-state-marker intake-state-marker-done" />}
                    {status === "active" && (
                      <span className="h-3 w-3 animate-spin rounded-full border-2 border-accent/25 border-t-accent" />
                    )}
                    {status === "pending" && <span className="intake-state-marker intake-state-marker-pending" />}
                    <span>{label}</span>
                  </div>
                  {status === "active" && i === 2 && (
                    <p className="intake-model-credit">Agente Pakta · razonamiento asistido por NVIDIA Nemotron 3.5 Lightning 30B</p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {state === "done" && result && (
        <div className="intake-state">
          <div className="intake-result-head">
            <p className="text-sm">
              <span className="text-ready">Listo.</span>{" "}
              {result.variantLabel ? `Caso — ${result.variantLabel}` : "Dataset"} — {result.ingested}{" "}
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
