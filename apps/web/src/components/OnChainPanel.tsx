"use client";

import { useEffect, useState } from "react";

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
      <p className="onchain-heading">Contrato en cadena</p>
      <div className="onchain-grid">
        <div className="onchain-row">
          <span className="onchain-label">Red</span>
          <span className="onchain-value">{health.network}</span>
        </div>
        <div className="onchain-row">
          <span className="onchain-label">PayableGate</span>
          <a
            className="onchain-value onchain-link"
            href={`${explorerBase(health.network)}/contract/${health.gate}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            {truncateId(health.gate)} ↗
          </a>
        </div>
        {vault ? (
          <>
            <div className="onchain-row">
              <span className="onchain-label">Vault disponible</span>
              <span className="onchain-value">
                {vault.available} {vault.asset}
              </span>
            </div>
            <div className="onchain-row">
              <span className="onchain-label">Vault comprometido</span>
              <span className="onchain-value">
                {vault.committed} {vault.asset}
              </span>
            </div>
            <div className="onchain-row">
              <span className="onchain-label">Settlements totales</span>
              <span className="onchain-value">{vault.settledCount}</span>
            </div>
          </>
        ) : (
          <p className="onchain-empty">
            {health.settlement === "enabled"
              ? "Cargando estado del vault…"
              : "Settlement real no configurado — este es el contrato desplegado, sin fondos moviéndose todavía."}
          </p>
        )}
      </div>
    </div>
  );
}
