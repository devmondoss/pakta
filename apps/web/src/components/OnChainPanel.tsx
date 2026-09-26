"use client";

import { useEffect, useState } from "react";
import { ArrowUpRight, Link2 } from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

type Health = { network: string; gate: string; settlement: "enabled" | "disabled" };
type Vault = { network: string; contractId: string; asset: string; committed: string; available: string; settledCount: number };

function explorerBase(network: string): string {
  return `https://stellar.expert/explorer/${network === "mainnet" ? "public" : network}`;
}

function truncateId(id: string): string {
  return id.length > 16 ? `${id.slice(0, 8)}…${id.slice(-6)}` : id;
}

/**
 * Datos reales del deployment — nada inventado. `GET /health` trae red y
 * contrato del manifiesto (`deployments/testnet.json`) siempre, sin
 * necesitar claves; `GET /vault` (balance comprometido/disponible en el
 * PayableGate) solo responde una vez que el settlement real está
 * configurado, así que este panel se degrada con gracia cuando no lo está.
 */
export function OnChainPanel() {
  const [health, setHealth] = useState<Health | null>(null);
  const [vault, setVault] = useState<Vault | null>(null);

  useEffect(() => {
    fetch(`${API_URL}/health`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then(setHealth)
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (health?.settlement !== "enabled") return;
    let active = true;
    async function load() {
      try {
        const res = await fetch(`${API_URL}/vault`, { cache: "no-store" });
        if (active && res.ok) setVault(await res.json());
      } catch {
        // API momentarily unreachable — keep showing the last known state.
      }
    }
    load();
    const id = setInterval(load, 6000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [health?.settlement]);

  if (!health) return null;

  return (
    <div className="onchain-panel">
      <div className="onchain-panel-head">
        <Link2 size={13} strokeWidth={2.4} className="onchain-panel-icon" />
        <p className="onchain-heading">Contrato en cadena</p>
        <span className="onchain-network-badge">{health.network}</span>
      </div>

      <a
        className="onchain-gate-link"
        href={`${explorerBase(health.network)}/contract/${health.gate}`}
        target="_blank"
        rel="noopener noreferrer"
      >
        <span className="onchain-label">PayableGate</span>
        <span className="onchain-gate-id">{truncateId(health.gate)}</span>
        <ArrowUpRight size={13} strokeWidth={2.4} className="onchain-gate-arrow" />
      </a>

      {vault ? (
        <div className="onchain-stats">
          <div className="onchain-stat onchain-stat-highlight">
            <span className="onchain-stat-label">Vault disponible</span>
            <span className="onchain-stat-value onchain-stat-value-available">
              {vault.available} <span className="onchain-stat-asset">{vault.asset}</span>
            </span>
          </div>
          <div className="onchain-stat">
            <span className="onchain-stat-label">Vault comprometido</span>
            <span className="onchain-stat-value">
              {vault.committed} <span className="onchain-stat-asset">{vault.asset}</span>
            </span>
          </div>
          <div className="onchain-stat onchain-stat-compact">
            <span className="onchain-stat-label">Settlements</span>
            <span className="onchain-stat-value">{vault.settledCount}</span>
          </div>
        </div>
      ) : (
        <p className="onchain-empty">
          {health.settlement === "enabled"
            ? "Cargando estado del vault…"
            : "Settlement real no configurado — este es el contrato desplegado, sin fondos moviéndose todavía."}
        </p>
      )}
    </div>
  );
}
