# Pakta — División de trabajo (2 devs)

**Versión:** 3.1 — Scrum y vault con caps para el MVP
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
- [ ] El contrato Soroban verifica firma y binding del proof, ID único con TTL retenido, estado, expiry, revocación, autorización del executor, destinatario/monto/SAC fijos, no doble pago, pausa y caps por pago y ventana; transfiere de su balance y está desplegado en testnet (Dev 1).
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
- [x] Dev 1: scaffold de `contracts/payable-contract`, paquetes `proof-hash` y `stellar-sdk-wrapper`; compilan en local. Seis direcciones públicas reales de testnet en `fixtures/stellar-testnet-addresses.json` (cinco vendors y wallet alternativa de INV-004), con XLM de Friendbot; las claves siguen fuera de Git. `node --test scripts/verify-demo-addresses.test.mjs` comprueba formato, checksum y unicidad.
- [ ] Dev 1 + Dev 2: cerrar juntos el schema firmado v1.1 de §7 y actualizar el fixture de Dev 2 sin perder el resultado 1 READY + 4 BLOCKED. Las trustlines del asset de demo siguen pendientes.

---

## 4. Dev 1 — Web3 / Settlement

**Pregunta que responde:** *"Dado un Proof-of-Payable válido, ¿cómo se mueve el dinero desde un vault de float acotado en Stellar de forma verificable y sin poder pagarse dos veces?"*

**Modelo MVP acordado por Dev 1:** Treasury fondea el contrato y fija `max_per_payable` y `max_per_window` para una ventana definida. El contrato custodia ese float y transfiere desde su propio balance. Treasury conserva sus claves; administra pausas, límites y retiros de saldo no comprometido. Una futura account contract (SEP-45) podría eliminar esta custodia. El issuer firma un digest que vincula `proof_hash` con red, contrato, payable, recipient, SAC, amount, policy y expiry. La firma verificada autoriza `register_payable()` aunque lo invoque cualquiera. `settle(payable_id)` exige `executor.require_auth()` y no acepta ni destinatario ni monto.

### Sprint 1 — Sprint Goal: *"Un contrato Soroban en testnet cuyo registro firmado, anti-replay y límites del vault estén probados con tests."*

| ID | Historia de usuario | Criterios de aceptación | Verificación (DoD) | Estado |
|---|---|---|---|:---:|
| HU-D1-01 | Como equipo, quiero un esqueleto de contrato desplegado en testnet, para validar el toolchain (Stellar CLI, `wasm32v1-none`) antes de invertir en lógica. | El contrato responde a `stellar contract invoke` real contra testnet. | `stellar contract deploy` exitoso + contract id documentado en README del paquete. | ⬜ |
| HU-D1-02 | Como sistema, quiero estado on-chain mínimo y auditable. | `Config` guarda treasury/admin, executor, issuer, SAC, caps, ventana y pausa. `Payable` guarda ID único, `proof_hash`, recipient, amount, policy hash, expiry y estado `READY/REVOKED/SETTLED/EXPIRED`. Storage persistente con TTL renovado; sin `payer` ni `nonce` por payable. | Escribir/releer ambos; probar retención del ID durante la vida declarada del vault. | ⬜ |
| HU-D1-03 | Como issuer, quiero registrar un proof `READY` firmado. | `register_payable()` recalcula el digest de argumentos tipados, verifica Ed25519 contra issuer permitido y rechaza ID usado, monto no positivo o sobre cap, expiry vencido y vault pausado. Puede invocarlo cualquiera. | Éxito; firma falsa/issuer ajeno/argumento alterado/duplicado/monto/expiry/pausa rechazados. | ⬜ |
| HU-D1-04 | Como equipo, quiero paridad criptográfica TS↔Rust. | `proof_hash = SHA-256(JCS(unsigned_proof))`; digest de registro vincula red, contrato, ID, hash, recipient, SAC, amount, policy y expiry. No existe `submit_proof()` on-chain. | Vectores fijos JCS/hash/digest; cada mutación de argumento invalida la firma. | ⬜ |
| HU-D1-05 | Como issuer, quiero auditoría del ciclo de vida y revocación efectiva. | `attest_lifecycle()` emite eventos autorizados sin modificar el gate; `revoke_payable()` cambia `READY → REVOKED` y evita el pago. | Fases enumeradas, auth del issuer, revocado no liquida, `SETTLED` no se revoca. | ⬜ |
| HU-D1-06 | Como kernel, quiero revalidar excepciones antes de registrar un pago. | `BLOCKED → RESOLUTION_PENDING → READY` ocurre fuera de cadena. Solo se registra tras proof nuevo firmado; un ID revocado no se reabre. La reemisión con otro ID/versionado requiere diseño conjunto. | Demo registra INV-004/005 después de revalidación; ID revocado no se reutiliza. | ⬜ |
| HU-D1-07 | Como Treasury, quiero liquidar sin doble pago ni sustitución de destino. | `settle(payable_id)` solo acepta ID, exige auth del executor, `READY`, no vencido, no revocado, vault activo, cap de ventana y saldo suficiente. Lee recipient, amount y SAC guardados; transfer y `SETTLED` son atómicos. | Tests por cada gate, segundo settle, saldos exactos y evento. | ⬜ |
| HU-D1-08 | Como sistema, quiero `expire()` permissionless. | `now > expiry`, solo desde estado no terminal; conserva marcador anti-replay. | Pruebas antes/después del vencimiento y contra `SETTLED`. | ⬜ |

**Sprint Review 1:** `cargo test --package payable-contract` en verde con cada criterio de seguridad probado + contract ID de testnet documentado y probado con invocación real. El scaffold de Día 0 no completa HU-D1-01 hasta ese deploy.

### Sprint 2 — Sprint Goal: *"El Settlement Adapter toma un `ProofOfPayable` real de Dev 2 y mueve USDC de verdad en testnet."*

| ID | Historia de usuario | Criterios de aceptación | Verificación (DoD) | Estado |
|---|---|---|---|:---:|
| HU-D1-09 | Como Treasury, quiero que `settle()` transfiera USDC vía SAC desde el vault. | `token::Client::transfer(env.current_contract_address(), recipient_guardado, amount_guardado)` en el mismo call atómico; destinatario `G...` con trustline del asset. Treasury puede retirar saldo no comprometido con auth y prueba. | Test con token/SAC: balances exactos, caps por pago/ventana y tx real en testnet. | ⬜ |
| HU-D1-10 | Como sistema, quiero un Settlement Adapter que consuma el `ProofOfPayable` compartido y decida el rail. | Acepta el objeto de Dev 2 sin cambiar su significado; valida hash/red/contrato y codifica determinísticamente decimal→`i128`, fecha→Unix, direcciones→bytes. | Proof real de Dev 2; rechazar monto con >7 decimales, address inválida o hash distinto. | ⬜ |
| HU-D1-11 | Como cuenta Stellar, quiero autenticarme vía SEP-10 antes de que el adapter opere en su nombre. | Challenge/response SEP-10 completo contra testnet. | Test de integración con el Anchor Platform de testnet. | ⬜ |

**Sprint Review 2:** un `ProofOfPayable` insertado por Dev 2 se liquida en testnet sin que Dev 1 toque su forma — la prueba de que el contrato de datos aguanta.

### Sprint 3 — Sprint Goal: *"Todo lo que se liquida queda reconciliado de vuelta contra su payable original, sin intervención manual."*

| ID | Historia de usuario | Criterios de aceptación | Verificación (DoD) | Estado |
|---|---|---|---|:---:|
| HU-D1-12 | Como sistema, quiero un Event Indexer que consuma `getEvents` y escriba `Settlement`. | Captura `payable_ready`, `settlement_executed`, `payable_reconciled`. | Test contra un stream de eventos simulado + prueba real contra testnet. | ⬜ |
| HU-D1-13 | Como Treasury, quiero revalidar justo antes de `settle()` que el proof sigue vigente (§14.3). | Adapter consulta estado del kernel; si queda stale, issuer revoca on-chain antes de permitir otro pago. Auth del executor evita saltarse el adapter. El contrato también comprueba expiry y campos guardados. | Stale rechazado off-chain; invocación directa rechazada para ID revocado. | ⬜ |
| HU-D1-14 | Como Accounting, quiero un export de reconciliación de vuelta a Excel/CSV. | Lee `settlements` + `payables`, no necesita saber cómo se generó el proof. | Test de exportación contra datos de settlement reales. | ⬜ |
| HU-D1-15 | Como Treasury, quiero un Settlement Agent que ejecute payables válidos sin aprobación humana por pago. | Worker prioriza por vencimiento/riesgo, revalida en el kernel, invoca únicamente `settle(payable_id)`, reintenta con backoff y consulta estado on-chain antes de reintentar; nunca firma proofs. | Test de flujo READY/BLOCKED/stale, idempotencia y corrida testnet sin paso manual por payable. | ⬜ |
| HU-D1-16 | Como integrador, quiero herramientas MCP de settlement con parámetros mínimos. | `list_ready_payables`, `explain_payable`, `settle_payable({payable_id})` y `get_settlement_proof`; ninguna herramienta que mueve dinero acepta recipient ni amount. | Schema rechaza esos campos; prompt adversarial no modifica un destinatario firmado; prueba de extremo a extremo. | ⬜ |

**Sprint Review 3 / Demo:** las 5 invoices del demo script (§25) corren end-to-end — nivel 4, la Definition of Done de plataforma completa.

### Fuera de su scope
Parsing de documentos, prompts, extracción, reglas de negocio del kernel, UI del dashboard más allá de Settlement/Reconciliation.

### Riesgos
- Replay de un proof ya usado → marcador persistente de `payable_id` con TTL renovado; la auth del executor es un control distinto.
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
| Sprint 3 | ⬜ 0/5 historias | ⬜ 0/4 historias |
| **Total Fase 1** | **0/16** | **10/19** |

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

### Acuerdo de datos v1.1 para el vault (pendiente de edición conjunta del schema)

Dev 2 añadirá `receipt_hash` a la evidencia y `proof_hash`, `issuer_public_key`, `issuer_signature`, `network_passphrase` y `contract_id` al proof firmado. Dev 1 añadirá `proof_hash` y `contract_id` a `Settlement`. `proof_hash` se representa como 64 hex minúsculos, `issuer_public_key` como StrKey `G...`, `issuer_signature` como base64 de 64 bytes Ed25519, `expires_at` como UTC sin fracciones y `amount` como decimal positivo con máximo siete decimales. El objeto anterior sigue describiendo el schema **implementado hoy**; ninguno debe afirmar que v1.1 ya está integrado. `payer` es configuración del vault. `payable_id` identifica una autorización de un solo uso; no hay `nonce` adicional. Las wallets del fixture deben reemplazarse por las direcciones públicas válidas de `fixtures/stellar-testnet-addresses.json` en el dominio de Dev 2.

El payload sin firma incluye exactamente los campos actuales de `ProofOfPayable` más `receipt_hash`. `proof_hash = SHA-256(UTF-8(JCS(unsigned_proof)))` conforme a RFC 8785; excluye hash, firma y metadata de despliegue. El adapter lo recalcula y rechaza diferencias. Para el contrato, la firma Ed25519 cubre `SHA-256(domain || network_id || contract_id || payable_id_hash || proof_hash || recipient || asset_contract_id || amount || policy_hash || expiry)`. `domain` es ASCII `PAKTA_REG_V1` + byte `00`; `network_id` es SHA-256 de la passphrase UTF-8; cada ID/address/hash binario ocupa 32 bytes; `amount` es `i128` positivo big endian en unidades de 10⁻⁷; `expiry` es `u64` big endian en segundos Unix. `payable_id_hash` es SHA-256 del ID UTF-8; `policy_hash` es SHA-256 de `policy_version` UTF-8. El contrato recalcula este digest desde los argumentos tipados y su red/configuración antes de verificar la firma. El issuer de MVP es único; la rotación de issuer requiere auth de admin. Vectores fijos TS↔Rust deben cubrir cambio de red, contrato, ID, recipient, SAC, monto, policy y expiry.

La retención del marcador de ID tiene una vida declarada y mantenimiento de TTL; caducar ese storage permitiría registrar otra vez el mismo ID. `executor.require_auth()` protege el acceso a `settle`, mientras la unicidad de ID evita replay. En el demo, un invoice bloqueado se registra **después** de revalidación; un proof registrado y revocado no se reabre con el mismo ID. Reemisión con ID/versionado nuevo se diseña entre ambos devs.

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
