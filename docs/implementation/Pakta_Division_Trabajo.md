# Pakta — División de trabajo (2 devs)

**Versión:** 3.0 — metodología Scrum aplicada
**Fecha:** 23 de septiembre de 2026
**Referencia:** `Pakta_Documento_Maestro.md` (tesis de producto), `Pakta_Plan_Implementacion.md` (stack completo) y `Pakta_Arquitectura_Flujo.md` (diagramas y roadmap)

> Corte exacto entre **Dev 1 (Web3 / Settlement)** y **Dev 2 (Agentic / AI Workflows)**, el contrato de datos que los conecta, y — desde esta versión — **sprints con historias de usuario, criterios de aceptación y Definition of Done por historia**, no un checkbox por semana.

---

## 1. El corte, en una frase

```text
Dev 2 decide si el payable PUEDE pagarse.
Dev 1 hace que el pago SUCEDA en Stellar y quede probado.
```

- **Dev 2** posee todo lo que ocurre **antes** de que exista un Proof-of-Payable: ingestion, AI extraction, deterministic control kernel, exceptions, y el propio Proof-of-Payable Builder.
- **Dev 1** posee todo lo que ocurre **desde** que un Proof-of-Payable existe: el Settlement Adapter, el contrato Soroban, el indexer de eventos y la reconciliation on-chain.

Ninguno de los dos toca el dominio del otro. Se comunican solo a través del contrato de datos de la sección 7.

---

## 2. Metodología: Scrum aplicado a un equipo de 2

Cada **semana de Fase 1 = un Sprint**. Cada Sprint tiene un **Sprint Goal** y se descompone en **historias de usuario** (formato "Como \<rol\>, quiero \<capacidad\>, para \<razón\>"), cada una con sus propios **criterios de aceptación** y su propia **Definition of Done verificable por comando** — así hay muchos checkpoints pequeños en vez de uno grande al final de la semana, y cualquiera (el otro dev, un jurado) puede confirmar el avance sin preguntar.

### Definition of Ready (antes de tomar una historia)

- [ ] Tiene criterios de aceptación escritos, no implícitos.
- [ ] Sus dependencias ya existen (el contrato de datos, el fixture, la historia anterior de la que depende).
- [ ] Se sabe de antemano qué test/comando la va a probar.

### Definition of Done (aplica a **toda** historia, sin excepción)

- [ ] Código escrito y el paquete compila (`tsc --noEmit` limpio, o `cargo build` limpio del lado Dev 1).
- [ ] Tests de la historia en verde.
- [ ] `pnpm test` (o `cargo test`) completo sigue en verde — no rompió nada que ya funcionaba.
- [ ] Mergeado a `main` — una historia que vive solo en una rama local no cuenta como hecha.
- [ ] Si introdujo una decisión de diseño no obvia, queda un comentario `// why` en el código, no solo en este doc.

### Definition of Done — **plataforma completa** ("¿ya terminamos de construir Pakta?")

La plataforma está terminada para el hackathon cuando **todo** lo siguiente es cierto a la vez, no una parte:

- [ ] Las 8 reglas del kernel están implementadas y testeadas (Dev 2).
- [ ] El contrato Soroban aplica los 4 invariantes de settlement y está desplegado en testnet (Dev 1).
- [ ] AI Extraction Service convierte al menos PDF + email en `CanonicalPayable`, no solo el workbook (Dev 2).
- [ ] Exception Service enruta y notifica de verdad (no solo produce el objeto `Exception`) (Dev 2).
- [ ] Proof-of-Payable Builder entrega un `ProofOfPayable` real al Settlement Adapter, sin intervención manual (Dev 2 → Dev 1).
- [ ] Settlement Adapter ejecuta un `transfer` real de USDC/SAC en testnet (Dev 1).
- [ ] Event Indexer captura el evento y lo reconcilia contra el payable original (Dev 1).
- [ ] Dashboard conectado a datos reales en los 5 módulos (Payables, Vendors & Wallets, Exceptions, Proof-of-Payable, Settlement/Reconciliación).
- [ ] El demo script completo de `Pakta_Documento_Maestro.md` §25 corre de punta a punta con las 5 invoices, sin pasos manuales ocultos.

---

## 3. Día 0 — lo que se hace juntos antes de separarse

- [x] Monorepo con pnpm workspaces.
- [x] `packages/canonical-model` — tipos compartidos. **Contrato entre los dos, se edita en pareja.**
- [ ] Esquema Postgres inicial — *no bloquea Fase 1, entra en Sprint 2 cuando haga falta persistencia real.*
- [x] Acuerdo de que el mockup (Pakta Control Room) es la referencia visual de comportamiento esperado.

---

## 4. Dev 1 — Web3 / Settlement

**Pregunta que responde:** *"Dado un Proof-of-Payable válido, ¿cómo se mueve el dinero en Stellar de forma verificable, sin custodia y sin poder pagarse dos veces?"*

### Sprint 1 — Sprint Goal: *"Un contrato Soroban en testnet cuyo state machine y anti-replay están probados con tests, aunque todavía no mueva USDC real."*

| ID | Historia de usuario | Criterios de aceptación | Verificación (DoD) | Estado |
|---|---|---|---|:---:|
| HU-D1-01 | Como equipo, quiero un esqueleto de contrato desplegado en testnet, para validar el toolchain (Stellar CLI, `wasm32v1-none`) antes de invertir en lógica. | El contrato responde a `stellar contract invoke` real contra testnet. | `stellar contract deploy` exitoso + contract id documentado en README del paquete. | ⬜ |
| HU-D1-02 | Como sistema, quiero el estado mínimo del `Payable` definido en storage persistente, para tener un modelo on-chain auditable. | `Payable { id, proof_hash, payer, recipient, asset, amount, policy_hash, expiry, status, nonce }` en storage `persistent`, no `temporary`. | Test que escribe y relee el struct. | ⬜ |
| HU-D1-03 | Como org, quiero `register_payable()`, para dejar constancia on-chain de una obligación antes de tener su proof. | Rechaza `id` duplicado, `amount <= 0`, `expiry` pasado; requiere `payer.require_auth()`. | 4 tests unitarios (éxito + 3 rechazos). | ⬜ |
| HU-D1-04 | Como proof issuer, quiero `submit_proof()`, para marcar un payable como `READY` cuando el kernel de Dev 2 ya lo verificó. | Solo transiciona desde `VERIFYING`; requiere `proof_issuer.require_auth()`; incrementa `nonce`. | 3 tests (transición válida, estado inválido, auth). | ⬜ |
| HU-D1-05 | Como Vendor Master/Treasury, quiero `block_payable()` + `resolve_exception()`, para que el contrato refleje el ciclo de excepción-resolución, no solo éxito/fracaso. | `block_payable` legal desde `VERIFYING`/`READY`; `resolve_exception` legal solo desde `BLOCKED`; ambos incrementan `nonce`. | 4 tests (uno por transición + 1 de nonce). | ⬜ |
| HU-D1-06 | Como proof issuer, quiero `revalidate()`, para reabrir la ventana de settlement con evidencia nueva, no con la vieja re-aprobada. | Exige `proof_hash`/`expiry` nuevos; legal solo desde `RESOLUTION_PENDING`; incrementa `nonce`. | 2 tests. | ⬜ |
| HU-D1-07 | Como Treasury, quiero `settle()` a prueba de doble pago y de sustitución de destinatario. | (a) Solo si `status == READY`; (b) rechaza si expiró; (c) rechaza si el `nonce` no coincide; (d) **no recibe `recipient`/`amount` como parámetros** — solo usa lo ya guardado en `register_payable`; (e) transición atómica + evento. | 6 tests, uno por criterio + 1 de doble-settlement explícito. | ⬜ |
| HU-D1-08 | Como sistema, quiero `expire()` permissionless, para que un payable vencido no quede colgado esperando que alguien lo cierre. | Legal desde cualquier estado no terminal si `now > expiry`; sin `require_auth()`. | 2 tests. | ⬜ |

**Sprint Review 1:** `cargo test --package payable-contract` en verde (≥21 tests, uno por criterio de arriba) + el contract id de testnet documentado y probado con una invocación real.

### Sprint 2 — Sprint Goal: *"El Settlement Adapter toma un `ProofOfPayable` real de Dev 2 y mueve USDC de verdad en testnet."*

| ID | Historia de usuario | Criterios de aceptación | Verificación (DoD) | Estado |
|---|---|---|---|:---:|
| HU-D1-09 | Como Treasury, quiero que `settle()` ejecute un transfer real de USDC vía SAC, no solo cambiar el status. | `token::Client::transfer(payer, recipient, amount)` dentro del mismo call atómico. | Test contra un token SAC de prueba + invocación real en testnet. | ⬜ |
| HU-D1-10 | Como sistema, quiero un Settlement Adapter que reciba un `ProofOfPayable` (contrato de datos, sección 7) y decida el rail (SAC por defecto). | Acepta el shape exacto del contrato de datos sin transformarlo. | **Integration checkpoint**: probado contra un `ProofOfPayable` producido por Dev 2, no un mock propio. | ⬜ |
| HU-D1-11 | Como cuenta Stellar, quiero autenticarme vía SEP-10 antes de que el adapter opere en su nombre. | Challenge/response SEP-10 completo contra testnet. | Test de integración con el Anchor Platform de testnet. | ⬜ |

**Sprint Review 2:** un `ProofOfPayable` insertado por Dev 2 se liquida en testnet sin que Dev 1 toque su forma — la prueba de que el contrato de datos aguanta.

### Sprint 3 — Sprint Goal: *"Todo lo que se liquida queda reconciliado de vuelta contra su payable original, sin intervención manual."*

| ID | Historia de usuario | Criterios de aceptación | Verificación (DoD) | Estado |
|---|---|---|---|:---:|
| HU-D1-12 | Como sistema, quiero un Event Indexer que consuma `getEvents` y escriba `Settlement`. | Captura `payable_ready`, `settlement_executed`, `payable_reconciled`. | Test contra un stream de eventos simulado + prueba real contra testnet. | ⬜ |
| HU-D1-13 | Como Treasury, quiero revalidar justo antes de `settle()` que el proof no expiró y que amount/recipient no cambiaron (§14.3). | Un proof stale se rechaza aunque `status` siga en `READY`. | Test que fuerza un proof vencido y confirma el rechazo. | ⬜ |
| HU-D1-14 | Como Accounting, quiero un export de reconciliación de vuelta a Excel/CSV. | Lee `settlements` + `payables`, no necesita saber cómo se generó el proof. | Test de exportación contra datos de settlement reales. | ⬜ |

**Sprint Review 3 / Demo:** las 5 invoices del demo script (§25) corren end-to-end — nivel 4, la Definition of Done de plataforma completa.

### Fuera de su scope
Parsing de documentos, prompts, extracción, reglas de negocio del kernel, UI del dashboard más allá de Settlement/Reconciliation.

### Riesgos
- Replay de un proof ya usado → `nonce` en contrato + unicidad de `payable_id`.
- Ventana entre proof generado y settlement ejecutado → HU-D1-13.
- Falla de posting a ERP después de settlement confirmado → `erp_posting_status` con reintentos.

---

## 5. Dev 2 — Agentic / AI Workflows

**Pregunta que responde:** *"Dada una carpeta de Excel/PDF/email, ¿cómo se convierte eso en payables verificados, exceptions accionables, y finalmente en un Proof-of-Payable?"*

### Sprint 1 — Sprint Goal: *"El fixture canónico de 5 invoices corre de punta a punta: workbook → payables → 1 READY + 4 BLOCKED exactos."* ✅ **Sprint completado**

| ID | Historia de usuario | Criterios de aceptación | Verificación (DoD) | Estado |
|---|---|---|---|:---:|
| HU-D2-01 | Como sistema, quiero parsear un workbook `.xlsx`/`.csv` con sus 5 hojas y normalizarlo al Canonical Payable Model. | Dado un workbook válido, `ingestWorkbook()` devuelve N `CanonicalPayable` sin rechazos. | `pnpm --filter @pakta/ingestion test` | ✅ |
| HU-D2-02 | Como sistema, quiero rechazar filas malformadas una por una, sin abortar el resto del batch. | Fila con monto inválido o `vendor_id` vacío se rechaza sola; el resto del batch se ingesta igual. | Test con fixture de filas malformadas (3 rechazadas, 1 válida). | ✅ |
| HU-D2-03 | Como sistema, quiero aplicar `invoice.vendor_id == po.vendor_id` en ingestion, no en el kernel. | Una fila con PO de otro vendor se rechaza con `VENDOR_PO_MISMATCH`, no llega al kernel. | Test específico en `ingestWorkbook.test.ts`. | ✅ |
| HU-D2-04 | Como Procurement, quiero que una factura que excede su PO más allá de la tolerancia quede bloqueada. | `invoice.amount > po.amount × (1 + tolerance)` ⇒ `reason=PO_AMOUNT_MISMATCH`, `owner=PROCUREMENT`. | `vendorAmountMatch.test.ts` (4 tests). | ✅ |
| HU-D2-05 | Como Operations, quiero que una factura sin recepción confirmada, o con recepción parcial, quede bloqueada con el código correcto. | Sin receipt ⇒ `MISSING_RECEIPT`; receipt con qty menor ⇒ `PARTIAL_RECEIPT`. | `receiptCoverage.test.ts` (5 tests). | ✅ |
| HU-D2-06 | Como AP, quiero detectar facturas duplicadas o ya liquidadas. | Fingerprint ya conocido ⇒ `DUPLICATE_INVOICE`; fingerprint ya settled ⇒ `PAYMENT_ALREADY_SETTLED`. | `duplicateCheck.test.ts` (4 tests). | ✅ |
| HU-D2-07 | Como Vendor Master, quiero detectar wallets no atestiguadas o cambiadas. | Sin wallet atestiguada ⇒ `UNATTESTED_WALLET`; wallet distinta a la atestiguada ⇒ `VENDOR_WALLET_CHANGED` con `requiredAction="REVERIFY_VENDOR_WALLET"`. | `walletAttestation.test.ts` (4 tests). | ✅ |
| HU-D2-08 | Como Controller, quiero exigir doble aprobación por encima de un monto. | Monto > `second_approval_above` con solo 1 approval ⇒ `APPROVAL_MISSING`. | `approvalThreshold.test.ts` (4 tests). | ✅ |
| HU-D2-09 | Como sistema, quiero que `budget_available` y `proof_expiry` existan como reglas reales aunque no tengan datos que las activen todavía. | Ambas pasan (`ok:true`) cuando no hay fuente de budget/expiry, documentado como no-op deliberado, no como bug. | `structuralNoOps.test.ts` (6 tests). | ✅ |
| HU-D2-10 | Como CFO, quiero correr las 5 invoices canónicas y obtener 1 READY + 4 BLOCKED con `reason_code`/`owner`/`required_action` exactos del maestro. | Totales: 28,400 solicitado / 5,000 ready / 23,400 bloqueado; determinístico entre corridas. | `demo-fixture.test.ts` (8 tests). | ✅ |

**Sprint Review 1 — CUMPLIDO:**
```bash
pnpm install && pnpm test && pnpm typecheck
```
→ 45/45 tests, typecheck limpio. Verificado en `main` desde el commit `f032fa0`.

### Sprint 2 — Sprint Goal: *"Una factura real en PDF o email, no solo del fixture, produce el mismo `CanonicalPayable` que hoy produce el workbook — y las excepciones se enrutan de verdad."*

| ID | Historia de usuario | Criterios de aceptación | Verificación (DoD) | Estado |
|---|---|---|---|:---:|
| HU-D2-11 | Como AP, quiero que un PDF de invoice se lea automáticamente (LangGraph + Claude Agent SDK/ADK) con un nivel de confianza por campo. | Extrae vendor, monto, PO ref, wallet; cada campo con `confidence` y `source_excerpt`. | Test contra ≥3 PDFs de muestra con distinto layout. | ⬜ |
| HU-D2-12 | Como sistema, quiero que la salida de IA nunca se escriba directo a `payables`. | Toda extracción pasa por `extraction_proposals`; el kernel re-verifica contra fuentes deterministas antes de aceptar. | Test que fuerza una alucinación del modelo y confirma que no contamina el payable final. | ⬜ |
| HU-D2-13 | Como sistema, quiero leer invoices que llegan por email (inbox), no solo PDFs sueltos. | Un correo con adjunto PDF produce el mismo resultado que HU-D2-11. | Test de integración con un inbox de prueba. | ⬜ |
| HU-D2-14 | Como owner de una excepción, quiero recibir el `reason`/`owner`/`required_action` enrutado a mi bandeja, no solo verlo en un objeto interno. | Notificación real (email/webhook) por cada `Exception` nueva. | Test con un webhook de prueba que confirma el payload recibido. | ⬜ |
| HU-D2-15 | Como Vendor Master, quiero un flujo de reverificación de wallet cuando cambia, antes de que se levante el flag `wallet` en evidence. | Módulo Vendors & Wallets del mockup conectado: wallet pendiente → confirmación → `attestationStatus=ATTESTED`. | Test de integración del flujo completo de attestation. | ⬜ |

**Sprint Review 2:** una factura PDF real entra por AI Extraction y produce un `CanonicalPayable` que el kernel evalúa exactamente igual que uno salido del workbook — misma prueba de convergencia de modelo, ahora con fuente distinta.

### Sprint 3 — Sprint Goal: *"El pipeline completo, incluyendo el hand-off a Dev 1 y el dashboard, corre sin pasos manuales."*

| ID | Historia de usuario | Criterios de aceptación | Verificación (DoD) | Estado |
|---|---|---|---|:---:|
| HU-D2-16 | Como sistema, quiero un Proof-of-Payable Builder que arme el objeto de §6.1 apenas un payable llega a `READY`. | Genera el shape exacto del contrato de datos (sección 7), sin campos faltantes. | Test contra el schema `ProofOfPayable` de `@pakta/canonical-model`. | ⬜ |
| HU-D2-17 | Como Dev 1, quiero recibir el `ProofOfPayable` sin tener que transformarlo. | **Integration checkpoint**: Dev 1 lo consume tal cual, sin adaptador intermedio. | Corrida conjunta con el Settlement Adapter de Dev 1. | ⬜ |
| HU-D2-18 | Como CFO, quiero ver Payables/Vendors & Wallets/Exceptions/Proof-of-Payable con datos reales en el dashboard, no el mockup con datos fijos. | Los 4 módulos leen del backend real, no de arrays hardcodeados. | Prueba manual + smoke test de cada endpoint. | ⬜ |
| HU-D2-19 | Como equipo, quiero ensayar el demo script completo (§25) hasta el punto justo antes del settlement real. | Las 5 invoices, 2 resoluciones, revalidación — todo sin intervención manual salvo el `settle()` final de Dev 1. | Corrida en vivo, grabada o en vivo ante el equipo. | ⬜ |

**Sprint Review 3 / Demo:** mismo checkpoint que Dev 1 — nivel 4, Definition of Done de plataforma completa (sección 2).

### Fuera de su scope
El contrato Soroban, el SDK de Stellar, la ejecución de `settle()`, el indexer de eventos.

### Riesgos
- AI extraction alucina un campo que el kernel trata como válido → HU-D2-12 existe específicamente por esto.
- Prompt injection desde el contenido de un invoice/email → todo el contenido del documento se trata como dato, nunca como instrucción.

---

## 6. Tablero resumen (dónde estamos hoy)

| Sprint | Dev 1 — Web3/Settlement | Dev 2 — Agentic/AI |
|---|:---:|:---:|
| Sprint 1 | ⬜ 0/8 historias | ✅ 10/10 historias |
| Sprint 2 | ⬜ 0/3 historias | ⬜ 0/5 historias |
| Sprint 3 | ⬜ 0/3 historias | ⬜ 0/4 historias |
| **Total Fase 1** | **0/14** | **10/19** |

---

## 7. El contrato de datos (la única superficie compartida)

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

## 8. Qué pasa con el frontend

El dashboard (mockup ya publicado — Pakta Control Room) no se divide por dominio, se divide por módulo, y cada quien conecta su propio módulo a datos reales:

| Módulo del dashboard | Lo conecta |
|---|---|
| Payables, Vendors & Wallets, Exceptions | Dev 2 |
| Proof-of-Payable | Dev 2 (es su output) |
| Settlement, Reconciliación | Dev 1 |
| Overview (pipeline físico) | Ambos — lee de ambos dominios, se arma al final |
| Policy | Dev 2 (es configuración del kernel) |

---

*Este documento asume el stack y las fases de `Pakta_Plan_Implementacion.md` y los diagramas de `Pakta_Arquitectura_Flujo.md`. Fase 2 (connectors, policy builder, supplier portal) se reparte con el mismo criterio y el mismo formato: historias de usuario con criterios de aceptación y DoD verificable por comando.*
