"use client";

import { useEffect, useState } from "react";
import type { ActivityEntry } from "@/lib/api";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

type RunKind = "demo" | "workbook" | "pdf";

const KIND_BY_PREFIX: [prefix: string, kind: RunKind][] = [
  ["Datos de ejemplo cargados", "demo"],
  ["Workbook subido", "workbook"],
  ["Factura PDF leída por IA", "pdf"],
];

const KIND_LABEL: Record<RunKind, string> = { demo: "Ejemplo", workbook: "Workbook", pdf: "PDF · IA" };

function classify(message: string): RunKind | undefined {
  return KIND_BY_PREFIX.find(([prefix]) => message.startsWith(prefix))?.[1];
}

/**
 * Historial persistido de cada prueba corrida en la demo — "usar datos de
 * ejemplo" y cargas reales (workbook o PDF) — con fecha y hora. Vive
 * siempre visible bajo el panel de Intake, sin depender de `hasActed`: el
 * punto es mostrar qué se probó en TODA la sesión de demo, no solo desde
 * que esta pestaña se abrió.
 */
export function IntakeHistory() {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const res = await fetch(`${API_URL}/activity/runs`, { cache: "no-store" });
        if (active && res.ok) setEntries(await res.json());
      } catch {
        // API momentarily unreachable — keep showing the last known state.
      }
    }
    load();
    const id = setInterval(load, 4000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  const runs = entries.flatMap((entry) => {
    const kind = classify(entry.message);
    return kind ? [{ entry, kind }] : [];
  });

  return (
    <div className="intake-history">
      <p className="intake-history-heading">Historial de pruebas{runs.length > 0 ? ` · ${runs.length}` : ""}</p>
      {runs.length === 0 ? (
        <p className="intake-history-empty">Todavía no corriste ninguna prueba — subí un archivo o usá datos de ejemplo arriba.</p>
      ) : (
        <div className="intake-history-list">
          {runs.map(({ entry, kind }) => (
            <div key={entry.id} className="intake-history-row">
              <span className={`intake-history-tag intake-history-tag-${kind}`}>{KIND_LABEL[kind]}</span>
              <span className="intake-history-message">{entry.message}</span>
              <time className="intake-history-time">
                {new Date(entry.occurredAt).toLocaleString("es", {
                  day: "2-digit",
                  month: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </time>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
