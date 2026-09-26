import type { Payable } from "@/lib/api";

function formatUsd(amount: number): string {
  return amount.toLocaleString("es", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * El agregado del batch — cuánto está listo, bloqueado o ya liquidado.
 * Se deriva del mismo `payables` que ya trae el board (actualizado por su
 * propio polling), en vez de pedirle un dato aparte a /summary, para que
 * nunca se desincronice de lo que la demo está mostrando abajo.
 */
export function SummaryStrip({ payables }: { payables: Payable[] }) {
  let totalReady = 0;
  let totalBlocked = 0;
  let totalSettled = 0;
  let readyCount = 0;
  let blockedCount = 0;
  let settledCount = 0;

  for (const p of payables) {
    const amount = Number(p.amount);
    if (p.status === "SETTLED") {
      totalSettled += amount;
      settledCount++;
    } else if (p.status === "READY") {
      totalReady += amount;
      readyCount++;
    } else {
      totalBlocked += amount;
      blockedCount++;
    }
  }

  const tiles = [
    { label: "Ready", amount: totalReady, count: readyCount, kind: "ready" },
    { label: "Bloqueado", amount: totalBlocked, count: blockedCount, kind: "blocked" },
    { label: "Settled", amount: totalSettled, count: settledCount, kind: "settled" },
  ] as const;

  return (
    <div className="summary-strip">
      {tiles.map((tile) => (
        <div key={tile.label} className={`summary-tile summary-tile-${tile.kind}`}>
          <span className="summary-tile-label">{tile.label}</span>
          <strong className="summary-tile-amount">USD {formatUsd(tile.amount)}</strong>
          <span className="summary-tile-count">
            {tile.count} {tile.count === 1 ? "payable" : "payables"}
          </span>
        </div>
      ))}
    </div>
  );
}
