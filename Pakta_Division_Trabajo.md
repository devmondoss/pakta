# Pakta — División de trabajo (2 devs)

**Versión:** 1.0
**Fecha:** 23 de septiembre de 2026
**Referencia:** `Pakta_Documento_Maestro.md` (tesis de producto) y `Pakta_Plan_Implementacion.md` (stack completo)

> Este documento define el corte exacto entre **Dev 1 (Web3 / Settlement)** y **Dev 2 (Agentic / AI Workflows)**, y el contrato de datos que los conecta para que ambos puedan trabajar en paralelo sin bloquearse.

---

## 1. El corte, en una frase

```text
Dev 2 decide si el payable PUEDE pagarse.
Dev 1 hace que el pago SUCEDA en Stellar y quede probado.
```

- **Dev 2** posee todo lo que ocurre **antes** de que exista un Proof-of-Payable: ingestion, AI extraction, deterministic control kernel, exceptions, y el propio Proof-of-Payable Builder.
- **Dev 1** posee todo lo que ocurre **desde** que un Proof-of-Payable existe: el Settlement Adapter, el contrato Soroban, el indexer de eventos y la reconciliation on-chain.

Ninguno de los dos toca el dominio del otro. Se comunican solo a través del contrato de datos de la sección 4.

---

## 2. Día 0 — lo que se hace juntos antes de separarse

Ambos deben acordar y crear esto en conjunto (media jornada, no más) antes de dividir:

1. Monorepo con pnpm workspaces + Turborepo (estructura ya definida en `Pakta_Plan_Implementacion.md`, sección 4).
2. El paquete `packages/canonical-model` — los tipos TypeScript compartidos (`Payable`, `Exception`, `ProofOfPayable`, `Settlement`). **Esto es el contrato entre los dos. Se edita en pareja, no unilateralmente.**
3. Esquema Postgres inicial (sección 5 del plan de implementación) — las tablas `payables`, `proofs` y `settlements` son la frontera física entre ambos dominios.
4. Acuerdo de que el mockup ya publicado (Pakta Control Room) es la referencia visual de comportamiento esperado — no hace falta rediseñar UI, hace falta hacerla real.

---

## 3. Dev 1 — Web3 / Settlement

**Pregunta que responde:** *"Dado un Proof-of-Payable válido, ¿cómo se mueve el dinero en Stellar de forma verificable, sin custodia y sin poder pagarse dos veces?"*

### Paquetes que posee
- `contracts/payable-contract/` (Soroban, Rust)
- `packages/stellar-sdk-wrapper/`
- Dentro de `apps/api/`: el **Settlement Adapter** y el **Event Indexer Worker**

### Tareas — Fase 1 (semanas 1-3, MVP hackathon)

**Semana 1**
- Deploy de contrato Soroban vacío en testnet + pipeline de deploy (Soroban CLI en CI).
- Definir el estado mínimo del contrato (`Pakta_Plan_Implementacion.md` sección 3 y `Pakta_Documento_Maestro.md` sección 19.1):
  ```rust
  Payable { id, proof_hash, payer, recipient, asset, amount, policy_hash, expiry, status, nonce }
  ```
- Funciones: `register_payable`, `submit_proof`, `block_payable`, `resolve_exception`, `revalidate`, `settle`, `expire`.
- Tests unitarios de invariantes (sección 19.2 del maestro): no doble settlement, nonce no reutilizable, solo `settle()` si `status == READY`.

**Semana 2**
- Integración con Stellar Asset Contract (SAC) para transfer de USDC testnet.
- `Settlement Adapter` en el backend: recibe un Proof-of-Payable de Dev 2 vía la tabla `proofs`, decide el rail (SAC por defecto en el MVP; x402/MPP quedan definidos pero no implementados) y ejecuta el `settle()`.
- SEP-10 para autenticación de cuentas Stellar (SEP-45 opcional si se usa contract account).

**Semana 3**
- Event Indexer Worker: consume `getEvents` de Stellar RPC (`payable_ready`, `settlement_executed`, `payable_reconciled`) y escribe en la tabla `settlements`.
- Revalidation at execution time (sección 14.3 del maestro): antes de `settle()`, revisar que el proof no expiró y que amount/recipient no cambiaron.
- Reconciliation export de vuelta a Excel/CSV (lee de `settlements` + `payables`, no necesita saber cómo se generó el proof).

### Fuera de su scope (no lo toca)
- Parsing de documentos, prompts, extracción, reglas de negocio del kernel, UI del dashboard más allá de la vista de Settlement/Reconciliation.

### Riesgos que le tocan a Dev 1 (ver sección 8 del plan de implementación)
- Replay de un proof ya usado → `nonce` en contrato + unicidad de `payable_id`.
- Ventana entre proof generado y settlement ejecutado → revalidation check justo antes de `settle()`.
- Falla de posting a ERP después de settlement confirmado → `erp_posting_status` con reintentos.

### Definition of done — Fase 1
Un Proof-of-Payable válido insertado manualmente en `proofs` (sin depender de Dev 2 todavía) puede liquidarse en Stellar testnet, generar un tx real, y aparecer reconciliado en `settlements` con su `payable_id` correcto.

---

## 4. Dev 2 — Agentic / AI Workflows

**Pregunta que responde:** *"Dada una carpeta de Excel/PDF/email, ¿cómo se convierte eso en payables verificados, exceptions accionables, y finalmente en un Proof-of-Payable?"*

### Paquetes que posee
- Dentro de `apps/api/`: **Ingestion Service**, **AI Extraction Service**, **Deterministic Control Kernel**, **Exception Service**, **Proof-of-Payable Builder**
- `packages/ai-schemas/` (JSON Schemas / Zod para structured output de Claude)
- `packages/rules-kernel/` (el motor de reglas, testeable de forma aislada)

### Tareas — Fase 1 (semanas 1-3, MVP hackathon)

**Semana 1**
- Ingestion Service: parser de `.xlsx` con las 6 hojas del workbook demo (`VENDORS, PO, INVOICES, RECEIPTS, APPROVALS, PAKTA_STATUS`), normalizado al Canonical Payable Model.
- Deterministic Control Kernel: las 8 reglas de la sección 7.3 del maestro, como funciones puras con unit tests:
  ```text
  invoice.vendor_id == po.vendor_id
  invoice.amount <= po.remaining_amount + tolerance
  receipt.confirmed_quantity >= invoiced_quantity
  invoice_fingerprint NOT IN settled_invoices
  vendor_wallet == active_attested_wallet
  approval_threshold_satisfied == true
  budget_available >= amount
  payable.expiry > now
  ```

**Semana 2**
- AI Extraction Service: parsing de invoice PDF/email con Claude (structured output/tool use), incluyendo `confidence` y `source_excerpt` por campo. Escribe a `extraction_proposals`, nunca directo a `payables`.
- Exception Service: los reason codes de la sección 10 del maestro (`DUPLICATE_INVOICE`, `PO_AMOUNT_MISMATCH`, `VENDOR_WALLET_CHANGED`, `MISSING_RECEIPT`, etc.) con `owner_role`, `required_action` y notificación (email/webhook).
- Vendor wallet attestation flow: el módulo Vendors & Wallets del mockup — reverificación de wallet cuando cambia, antes de levantar el flag `wallet` en evidence.

**Semana 3**
- Proof-of-Payable Builder: arma el objeto de la sección 6.1 del maestro y lo inserta en `proofs` — este es el hand-off hacia Dev 1.
- Conectar el dashboard (ya prototipado en los mockups) a datos reales: Payables, Vendors & Wallets, Exceptions, Proof-of-Payable.
- Ensayo del demo script completo (sección 25 del maestro) hasta el punto justo antes del settlement real (que corre Dev 1).

### Fuera de su scope (no lo toca)
- El contrato Soroban, el SDK de Stellar, la ejecución de `settle()`, el indexer de eventos.

### Riesgos que le tocan a Dev 2 (ver sección 8 del plan de implementación)
- AI extraction alucina un campo que el kernel trata como válido → nunca escribir directo a `payables`; todo pasa por `extraction_proposals` con `confidence` y el kernel re-verifica contra fuentes deterministas.
- Prompt injection desde el contenido de un invoice/email → tratar todo el contenido del documento como dato, nunca como instrucción; el schema de salida no incluye campos de control de flujo.

### Definition of done — Fase 1
Correr las 5 invoices de ejemplo (sección 17.3/25 del maestro) produce automáticamente: 1 READY inmediato, 4 exceptions correctamente tipadas y enrutadas, y al resolver 2 de ellas, 3 filas nuevas en `proofs` — listas para que el Settlement Adapter de Dev 1 las tome.

---

## 5. El contrato de datos (la única superficie compartida)

No se coordinan por reuniones — se coordinan por este esquema. Vive en `packages/canonical-model` y ninguno lo cambia sin avisar al otro.

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

## 6. Qué pasa con el frontend

El dashboard (mockup ya publicado — Pakta Control Room) no se divide por dominio, se divide por módulo, y cada quien conecta su propio módulo a datos reales:

| Módulo del dashboard | Lo conecta |
|---|---|
| Payables, Vendors & Wallets, Exceptions | Dev 2 |
| Proof-of-Payable | Dev 2 (es su output) |
| Settlement, Reconciliación | Dev 1 |
| Overview (pipeline físico) | Ambos — lee de ambos dominios, se arma al final |
| Policy | Dev 2 (es configuración del kernel) |

---

## 7. Orden sugerido de integración

1. **Días 1-2:** cada uno trabaja aislado con datos mock/fixtures (los mismos del mockup: las 5 invoices de `INV-001` a `INV-005`).
2. **Primer punto de integración (fin de semana 1):** Dev 2 inserta un `ProofOfPayable` de prueba directo en Postgres; Dev 1 confirma que su Settlement Adapter lo puede tomar y liquidar en testnet sin cambios.
3. **Segundo punto de integración (fin de semana 2):** flujo completo end-to-end con al menos 1 invoice real desde ingestion hasta settlement.
4. **Semana 3:** las 5 invoices del demo script corriendo end-to-end, dashboard conectado, ensayo del demo.

---

*Este documento asume el stack y las fases definidas en `Pakta_Plan_Implementacion.md`. Cualquier cambio de alcance en Fase 2 (connectors, policy builder, supplier portal) se reparte con el mismo criterio: Dev 1 = lo que toca Stellar/contrato, Dev 2 = lo que toca ingestion/AI/reglas/exceptions.*
