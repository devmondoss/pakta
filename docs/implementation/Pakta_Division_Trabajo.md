# Pakta — División de trabajo (2 devs)

**Versión:** 2.0
**Fecha:** 23 de septiembre de 2026
**Referencia:** `Pakta_Documento_Maestro.md` (tesis de producto), `Pakta_Plan_Implementacion.md` (stack completo) y `Pakta_Arquitectura_Flujo.md` (diagramas y roadmap)

> Este documento define el corte exacto entre **Dev 1 (Web3 / Settlement)** y **Dev 2 (Agentic / AI Workflows)**, el contrato de datos que los conecta, y — a partir de esta versión — **checklists con checkpoints verificables por test**, no por sensación de "creo que ya quedó".

---

## 1. El corte, en una frase

```text
Dev 2 decide si el payable PUEDE pagarse.
Dev 1 hace que el pago SUCEDA en Stellar y quede probado.
```

- **Dev 2** posee todo lo que ocurre **antes** de que exista un Proof-of-Payable: ingestion, AI extraction, deterministic control kernel, exceptions, y el propio Proof-of-Payable Builder.
- **Dev 1** posee todo lo que ocurre **desde** que un Proof-of-Payable existe: el Settlement Adapter, el contrato Soroban, el indexer de eventos y la reconciliation on-chain.

Ninguno de los dos toca el dominio del otro. Se comunican solo a través del contrato de datos de la sección 6.

---

## 2. Metodología: cómo saber que algo está realmente terminado

Ningún checkbox de este documento se marca por opinión. Se marca porque existe una prueba automatizada (o, en el caso puntual de un deploy a testnet, una interacción real contra la red) que lo demuestra y que cualquiera puede volver a correr.

| Nivel | Qué prueba | Cómo se verifica |
|---|---|---|
| **1 — Unit test** | Una función pura, aislada (una regla del kernel, un invariante del contrato) | `pnpm --filter <paquete> test` — el archivo de test correspondiente en verde |
| **2 — Acceptance test** | El fixture completo (las 5 invoices canónicas) produce el resultado exacto documentado en el maestro | `pnpm test` en la raíz — el test end-to-end (`demo-fixture.test.ts` en Dev 2; su equivalente de contrato en Dev 1) |
| **3 — Integration checkpoint** | Algo cruza la frontera del contrato de datos (sección 6) y el otro lado lo puede consumir sin tocarlo | Se prueba con datos reales del otro dev, no con mocks propios (ver sección 8) |
| **4 — Demo end-to-end** | Todo el pipeline junto, incluyendo settlement real en Stellar testnet | Correr el demo script completo (`Pakta_Documento_Maestro.md` §25) de punta a punta |

Cada checkbox de las secciones 4 y 5 indica su nivel entre paréntesis. Un checkbox sin comando de verificación explícito **no se marca**, aunque el código "ya esté escrito".

---

## 3. Día 0 — lo que se hace juntos antes de separarse

- [x] Monorepo con pnpm workspaces (estructura base — `Turborepo` se agrega cuando haga falta cachear builds entre más paquetes, no antes).
- [x] El paquete `packages/canonical-model` — tipos compartidos (`CanonicalPayable`, `Exception`, `Policy`, `ProofOfPayable`, `Settlement`). **Esto es el contrato entre los dos. Se edita en pareja, no unilateralmente.**
- [ ] Esquema Postgres inicial (sección 5 del plan de implementación) — las tablas `payables`, `proofs` y `settlements` son la frontera física entre ambos dominios. *(no bloquea Fase 1: hoy el contrato de datos se prueba en memoria vía tests, Postgres entra en semana 2)*
- [x] Acuerdo de que el mockup ya publicado (Pakta Control Room) es la referencia visual de comportamiento esperado.

---

## 4. Dev 1 — Web3 / Settlement

**Pregunta que responde:** *"Dado un Proof-of-Payable válido, ¿cómo se mueve el dinero en Stellar de forma verificable, sin custodia y sin poder pagarse dos veces?"*

### Paquetes que posee
- `contracts/payable-contract/` (Soroban, Rust)
- `packages/stellar-sdk-wrapper/`
- Dentro de `apps/api/`: el **Settlement Adapter** y el **Event Indexer Worker**

### Checklist — Semana 1

- [ ] Deploy de contrato Soroban vacío en testnet + pipeline de deploy (Stellar CLI en CI). *(nivel 4 — deploy real, contract id documentado)*
- [ ] Estado mínimo del contrato definido (`Pakta_Plan_Implementacion.md` §3, `Pakta_Documento_Maestro.md` §19.1):
  ```rust
  Payable { id, proof_hash, payer, recipient, asset, amount, policy_hash, expiry, status, nonce }
  ```
- [ ] Entry points: `register_payable`, `submit_proof`, `block_payable`, `resolve_exception`, `revalidate`, `settle`, `expire`. *(nivel 1 — un test unitario por entry point)*
- [ ] Invariantes probados con tests (§19.2 del maestro): *(nivel 1, todos deben tener su propio test)*
  - [ ] No doble settlement
  - [ ] `nonce` no reutilizable (anti-replay)
  - [ ] `settle()` solo si `status == READY`
  - [ ] Recipient/amount exactos, sin sustitución posible

**✅ Checkpoint fin Semana 1:** `cargo test --package payable-contract` en verde cubriendo los 4 invariantes de arriba, y el contrato desplegado en testnet responde a `stellar contract invoke` real (no solo en tests locales).

### Checklist — Semana 2

- [ ] Integración con Stellar Asset Contract (SAC) para transfer de USDC testnet.
- [ ] `Settlement Adapter`: recibe un `ProofOfPayable` de Dev 2 (contrato de datos, sección 6), decide el rail (SAC por defecto) y ejecuta `settle()`. *(nivel 3 — probado contra un `ProofOfPayable` real producido por Dev 2, no un mock propio)*
- [ ] SEP-10 para autenticación de cuentas Stellar.

**✅ Checkpoint fin Semana 2:** un `ProofOfPayable` insertado por Dev 2 se liquida en testnet sin que Dev 1 tenga que tocar su forma — prueba que el contrato de datos aguanta.

### Checklist — Semana 3

- [ ] Event Indexer Worker: consume `getEvents` de Stellar RPC y escribe `Settlement`.
- [ ] Revalidation at execution time (§14.3 del maestro): antes de `settle()`, proof no expirado y amount/recipient sin cambios. *(nivel 1 — test que fuerza un proof stale y confirma el rechazo)*
- [ ] Reconciliation export de vuelta a Excel/CSV.

**✅ Checkpoint fin Semana 3 / Demo:** las 5 invoices del demo script (§25 del maestro) corren end-to-end — nivel 4.

### Fuera de su scope
Parsing de documentos, prompts, extracción, reglas de negocio del kernel, UI del dashboard más allá de Settlement/Reconciliation.

### Riesgos
- Replay de un proof ya usado → `nonce` en contrato + unicidad de `payable_id`.
- Ventana entre proof generado y settlement ejecutado → revalidation check justo antes de `settle()`.
- Falla de posting a ERP después de settlement confirmado → `erp_posting_status` con reintentos.

---

## 5. Dev 2 — Agentic / AI Workflows

**Pregunta que responde:** *"Dada una carpeta de Excel/PDF/email, ¿cómo se convierte eso en payables verificados, exceptions accionables, y finalmente en un Proof-of-Payable?"*

### Paquetes que posee
- `packages/canonical-model/` — tipos compartidos (construido en Día 0, mantenido por Dev 2)
- `packages/ingestion/` — Ingestion Service
- `packages/rules-kernel/` — Deterministic Control Kernel
- Dentro de `apps/api/` (semana 2+): **AI Extraction Service**, **Exception Service**, **Proof-of-Payable Builder**

### Checklist — Semana 1 ✅ **completada**

- [x] Ingestion Service: parser de `.xlsx`/`.csv` (`VENDORS, PO, INVOICES, RECEIPTS, APPROVALS`), normalizado al Canonical Payable Model, rechazo fila-por-fila sin abortar el batch. *(nivel 1+2)*
  → `pnpm --filter @pakta/ingestion test` — 4/4 passed
- [x] Deterministic Control Kernel: las 8 reglas de §7.3, cada una en su propio archivo con test unitario aislado. *(nivel 1)*
  → `pnpm --filter @pakta/rules-kernel test` — todas las reglas cubiertas, incluyendo las 2 estructuralmente no-op (`budget`, `proof_expiry`) documentadas como tal
- [x] Fixture canónico de 5 invoices (28,400 USDC) reconstruido en `fixtures/demo-workbook/`. *(nivel 2)*
- [x] Test de aceptación end-to-end: 1 READY + 4 BLOCKED con `reason_code`/`owner_role`/`required_action` exactos del maestro (incluye el string literal `"REVERIFY_VENDOR_WALLET"` de §5.3).

**✅ Checkpoint fin Semana 1 — CUMPLIDO:**
```bash
pnpm install
pnpm test        # 45/45 passed
pnpm typecheck    # clean
```
Verificado en `main` (commit `f032fa0` en adelante).

### Checklist — Semana 2

- [ ] AI Extraction Service: parsing de invoice PDF/email (LangGraph + Claude Agent SDK / Google ADK), con `confidence` y `source_excerpt` por campo. Escribe a `extraction_proposals`, nunca directo a `payables`. *(nivel 1 — tests por tipo de documento + un test que prueba que la IA nunca escribe directo al kernel)*
- [ ] Exception Service: reason codes de §10 con `owner_role`, `required_action` y notificación real (hoy el kernel produce el objeto `Exception`; falta el routing). *(nivel 1)*
- [ ] Vendor wallet attestation flow (módulo Vendors & Wallets del mockup). *(nivel 1)*

**✅ Checkpoint fin Semana 2:** una factura PDF real, no del fixture, entra por AI Extraction y produce el mismo tipo de `CanonicalPayable` que hoy produce `ingestWorkbook()` — prueba que ambas fuentes convergen al mismo modelo.

### Checklist — Semana 3

- [ ] Proof-of-Payable Builder: arma el objeto de §6.1 y lo entrega vía el contrato de datos (sección 6) — el hand-off hacia Dev 1. *(nivel 3)*
- [ ] Dashboard conectado a datos reales: Payables, Vendors & Wallets, Exceptions, Proof-of-Payable.
- [ ] Ensayo del demo script completo (§25) hasta el punto justo antes del settlement real.

**✅ Checkpoint fin Semana 3 / Demo:** mismo checkpoint que Dev 1, nivel 4 — las 5 invoices corriendo end-to-end con settlement real.

### Fuera de su scope
El contrato Soroban, el SDK de Stellar, la ejecución de `settle()`, el indexer de eventos.

### Riesgos
- AI extraction alucina un campo que el kernel trata como válido → nunca escribir directo a `payables`; todo pasa por `extraction_proposals` con `confidence`, y el kernel re-verifica contra fuentes deterministas.
- Prompt injection desde el contenido de un invoice/email → todo el contenido del documento se trata como dato, nunca como instrucción.

---

## 6. El contrato de datos (la única superficie compartida)

No se coordinan por reuniones — se coordinan por este esquema. Vive en `packages/canonical-model` (`src/proof.ts`, ya construido y con tests) y ninguno lo cambia sin avisar al otro.

```typescript
// Lo que Dev 2 produce y Dev 1 consume
type ProofOfPayable = {
  payable_id: string;
  invoice_hash: string;
  po_hash: string;
  vendor_id: string;
  vendor_wallet: string;
  wallet_attestation_version: number;
  amount: string;
  asset: string;              // "USDC"
  policy_version: string;     // "FIN-4.2"
  approvals_hash: string;
  cost_center: string;
  expires_at: string;         // ISO timestamp — Dev 1 lo revalida antes de settle()
  status: "READY";
};

// Lo que Dev 1 produce de vuelta y Dev 2 (y el dashboard) consumen
type Settlement = {
  payable_id: string;
  invoice_id: string;
  po_id: string;
  settlement: {
    network: "stellar";
    asset: string;
    amount: string;
    tx_hash: string;
    ledger: number;
  };
  status: "SETTLED";
  erp_posting_status: "PENDING" | "RECONCILED" | "FAILED";
};
```

Regla de oro: **Dev 1 nunca lee `extraction_proposals` ni las reglas del kernel. Dev 2 nunca escribe en `settlements` ni llama al contrato.** Si alguno necesita algo del lado del otro, se agrega al contrato de arriba — no se hace un atajo directo a la tabla o servicio interno del otro dominio.

---

## 7. Qué pasa con el frontend

El dashboard (mockup ya publicado — Pakta Control Room) no se divide por dominio, se divide por módulo, y cada quien conecta su propio módulo a datos reales:

| Módulo del dashboard | Lo conecta |
|---|---|
| Payables, Vendors & Wallets, Exceptions | Dev 2 |
| Proof-of-Payable | Dev 2 (es su output) |
| Settlement, Reconciliación | Dev 1 |
| Overview (pipeline físico) | Ambos — lee de ambos dominios, se arma al final |
| Policy | Dev 2 (es configuración del kernel) |

---

## 8. Checkpoints de integración (orden sugerido)

| # | Momento | Qué se prueba | Nivel | Estado |
|---|---|---|:---:|:---:|
| 1 | Días 1-2 | Cada uno trabaja aislado con las 5 invoices del fixture | 1-2 | ✅ Dev 2 · ⬜ Dev 1 |
| 2 | Fin semana 1 | Dev 2 inserta un `ProofOfPayable` de prueba; Dev 1 confirma que su Settlement Adapter lo toma sin cambios | 3 | ⬜ (depende de que Dev 1 tenga contrato + adapter) |
| 3 | Fin semana 2 | Flujo completo con al menos 1 invoice real, de punta a punta | 3 | ⬜ |
| 4 | Fin semana 3 | Las 5 invoices del demo script corriendo end-to-end, dashboard conectado | 4 | ⬜ |

**Checkpoint 1 detallado (el que ya se cumplió del lado Dev 2):**
```bash
pnpm install && pnpm test && pnpm typecheck
```
→ 45/45 tests, typecheck limpio, fixture de 5 invoices produce 1 READY + 4 BLOCKED exactos. Esto es lo que un tercero (jurado, el otro dev) puede correr sin contexto adicional para confirmar que "Semana 1 de Dev 2" no es una afirmación, es un resultado reproducible.

---

*Este documento asume el stack y las fases definidas en `Pakta_Plan_Implementacion.md` y los diagramas de `Pakta_Arquitectura_Flujo.md`. Cualquier cambio de alcance en Fase 2 (connectors, policy builder, supplier portal) se reparte con el mismo criterio: Dev 1 = lo que toca Stellar/contrato, Dev 2 = lo que toca ingestion/AI/reglas/exceptions — y todo checkbox nuevo lleva su comando de verificación.*
