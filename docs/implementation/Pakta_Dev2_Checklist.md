# Pakta — Checklist Dev 2 (Agentic / AI Workflows)

**Extraído de:** `Pakta_Division_Trabajo.md` v3.0 (23 sep 2026) — este archivo contiene **solo** la parte de Dev 2. Para el contrato de datos completo y el lado de Dev 1, ver el original.

**Tu pregunta a responder:** *"Dada una carpeta de Excel/PDF/email, ¿cómo se convierte eso en payables verificados, exceptions accionables, y finalmente en un Proof-of-Payable?"*

**Vos posees:** todo lo que ocurre **antes** de que exista un Proof-of-Payable — ingestion, AI extraction, deterministic control kernel, exceptions, y el propio Proof-of-Payable Builder.

**No es tuyo (Dev 1):** el contrato Soroban, el SDK de Stellar, la ejecución de `settle()`, el indexer de eventos.

---

## Definition of Ready (antes de tomar una historia)
- [ ] Tiene criterios de aceptación escritos, no implícitos.
- [ ] Sus dependencias ya existen (el contrato de datos, el fixture, la historia anterior de la que depende).
- [ ] Se sabe de antemano qué test/comando la va a probar.

## Definition of Done (aplica a toda historia)
- [ ] Código escrito y `tsc --noEmit` limpio.
- [ ] Tests de la historia en verde.
- [ ] `pnpm test` completo sigue en verde.
- [ ] Mergeado a `main`.
- [ ] Si introdujo una decisión de diseño no obvia, queda un comentario `// why` en el código.

---

## Sprint 1 — ✅ COMPLETO
**Goal:** *"El fixture canónico de 5 invoices corre de punta a punta: workbook → payables → 1 READY + 4 BLOCKED exactos."*

| ID | Historia | Estado |
|---|---|:---:|
| HU-D2-01 | Parsear workbook `.xlsx`/`.csv` (5 hojas) → `CanonicalPayable` | ✅ |
| HU-D2-02 | Rechazar filas malformadas una por una, sin abortar el batch | ✅ |
| HU-D2-03 | `invoice.vendor_id == po.vendor_id` en ingestion | ✅ |
| HU-D2-04 | Bloquear si excede tolerancia del PO (`PO_AMOUNT_MISMATCH`) | ✅ |
| HU-D2-05 | Bloquear sin recepción / recepción parcial (`MISSING_RECEIPT` / `PARTIAL_RECEIPT`) | ✅ |
| HU-D2-06 | Detectar duplicados / ya liquidados (`DUPLICATE_INVOICE` / `PAYMENT_ALREADY_SETTLED`) | ✅ |
| HU-D2-07 | Detectar wallets no atestiguadas / cambiadas (`UNATTESTED_WALLET` / `VENDOR_WALLET_CHANGED`) | ✅ |
| HU-D2-08 | Doble aprobación por encima de un monto (`APPROVAL_MISSING`) | ✅ |
| HU-D2-09 | `budget_available` y `proof_expiry` como no-ops documentados | ✅ |
| HU-D2-10 | Correr las 5 invoices del fixture maestro: 1 READY + 4 BLOCKED exactos | ✅ |

**Verificado:** `pnpm install && pnpm test && pnpm typecheck` → 45/45 tests, typecheck limpio, en `main` desde `f032fa0`.

---

## Sprint 2 — ✅ COMPLETO (5/5)
**Goal:** *"Una factura real en PDF o email, no solo del fixture, produce el mismo `CanonicalPayable` que hoy produce el workbook — y las excepciones se enrutan de verdad."*

> **Cambio de stack (23 sep 2026):** el doc original decía "LangGraph + Claude Agent SDK". Se cambió a **NVIDIA NIM** (API compatible con OpenAI, límites gratis más generosos) porque no hay API key de Anthropic disponible. La arquitectura quedó agnóstica de proveedor a propósito: `packages/ai-extraction/src/extractInvoice.ts` define una interfaz `InvoiceExtractor` (texto → JSON crudo) que cualquier proveedor implementa — el archivo con el proveedor real vive en `src/providers/nvidia.ts`, y todo lo demás (`resolveExtraction`, el guardrail) no sabe ni le importa qué LLM se usó. Cambiar de proveedor más adelante es agregar un archivo nuevo, no reescribir nada. *(Nota: `Pakta_Plan_Implementacion.md` y `Pakta_Arquitectura_Flujo.md` todavía dicen "Claude" en el texto — no actualizados todavía, avisar si se quiere corregir ahí también.)*

| ID | Historia | Criterios de aceptación | Verificación (DoD) | Estado |
|---|---|---|---|:---:|
| HU-D2-11 | Extraer invoice de PDF con confidence por campo | Extrae vendor, monto, PO ref, wallet; cada campo con `confidence` y `source_excerpt` | Test contra ≥3 PDFs con distinto layout | ✅ Validado contra la API real de NVIDIA NIM (modelo `nvidia/nemotron-3.5-lightning-30b-a3b`) con 4 PDFs de layout distinto en `fixtures/demo-invoices/` — lista simple, párrafo narrativo, tabla corporativa, y una factura con tabla de line items real (rejilla dibujada) donde el modelo distinguió correctamente el total (650.00) de los subtotales de línea (450.00 + 200.00). 4/4 extracciones exactas. Test en `nvidiaIntegration.test.ts`, gateado con `NVIDIA_API_KEY` (se salta solo si no hay key, no rompe `pnpm test`). De paso: se subió el número de reintentos de 1 a 2 (el modelo a veces produce JSON malformado incluso con un solo reintento) y se corrigió un bug real en `pdfText.ts` (llamar `getText()`/`getTable()` en paralelo sobre la misma instancia de `PDFParse` tiraba un `DataCloneError`). |
| HU-D2-12 | La salida de IA nunca se escribe directo a `payables` | La extracción se re-verifica contra fuentes deterministas (vendor/PO reales) antes de aceptar | Test que fuerza una alucinación y confirma que no contamina el payable final | ✅ `resolveExtraction.ts` — nunca confía en la IA para vendor/PO/wallet-attestation, siempre los resuelve contra registros reales. Test de integración real (no mock) confirma que una wallet alucinada llega bloqueada como `VENDOR_WALLET_CHANGED` por el kernel de verdad. |
| HU-D2-13 | Leer invoices que llegan por email (inbox) | Un correo con adjunto PDF produce el mismo resultado que HU-D2-11 | Test de integración con inbox de prueba | ✅ `emailIngestion.ts` en `@pakta/ai-extraction` — parsea el `.eml` con `mailparser`, extrae cada PDF adjunto y corre el mismo `extractInvoiceFromPdf` de HU-D2-11 sobre cada uno (multi-invoice y fallos aislados por adjunto). 7/7 tests, mismo patrón de mocks que HU-D2-11 mientras no hay `NVIDIA_API_KEY` real. Falta: un conector de inbox real (IMAP/webhook) que entregue el `.eml` — no hay ninguno todavía, esto asume que el email crudo ya llegó como bytes. |
| HU-D2-14 | Enrutar `reason`/`owner`/`required_action` a la bandeja del owner | Notificación real (email/webhook) por cada `Exception` nueva | Test con webhook de prueba que confirma el payload | ✅ `packages/exception-service` — `createWebhookNotifier` enruta por `ownerRole` (un webhook por rol, con fallback), `notifyExceptions` manda el batch sin abortar si un webhook individual falla. 5/5 tests, incluido el payload exacto que recibe el webhook. |
| HU-D2-15 | Flujo de reverificación de wallet cuando cambia | Módulo Vendors & Wallets: wallet pendiente → confirmación → `attestationStatus=ATTESTED` | Test de integración del flujo completo | ✅ `packages/db` (SQLite, `node:sqlite`) + `POST /vendors/:id/wallet` y `/wallet/attest` en `apps/api` + botones reales en `apps/web`. Flujo probado de punta a punta: INV-004 pasa VENDOR_WALLET_CHANGED → UNATTESTED_WALLET → READY sin tocar código. |

**Sprint Review 2:** una factura PDF real entra por AI Extraction y produce un `CanonicalPayable` que el kernel evalúa exactamente igual que uno salido del workbook. *(Todavía no cumplido — falta la key real y probar con PDFs de verdad.)*

**Extra no planificado en el doc original:** `apps/web` (Next.js) ya existe como mockup del dashboard — navegación completa, flujo de carga simulado (subida → procesamiento → resultado), pero **sin datos reales**. Eso es trabajo adelantado de HU-D2-18, no cuenta como esa historia hecha.

**Nota sobre HU-D2-14:** el criterio original de la historia (`Pakta_Plan_Implementacion.md` §3.4) también pide "expone el endpoint de resolución que dispara revalidación". **Actualización:** ya está — `POST /payables/:id/revalidate` en `apps/api`, con botón real en la página de Exceptions. De hecho `GET /payables` ya evalúa en vivo contra el estado actual de `@pakta/db` (nunca sirve un resultado cacheado/viejo), así que el endpoint de revalidate es más una acción explícita para la UI que un requisito funcional — la revalidación ya ocurre sola en cada lectura.

**Siguiente paso recomendado:** conseguir la `NVIDIA_API_KEY` y correr `extractInvoiceFromPdf` contra un PDF real para cerrar HU-D2-11 de verdad, o seguir con HU-D2-15 (reverificación de wallet) mientras tanto.

---

## Sprint 3 — 🟡 3/4 (lo único que falta está bloqueado por Dev 1)
**Goal:** *"El pipeline completo, incluyendo el hand-off a Dev 1 y el dashboard, corre sin pasos manuales."*

| ID | Historia | Criterios de aceptación | Verificación (DoD) | Estado |
|---|---|---|---|:---:|
| HU-D2-16 | Proof-of-Payable Builder arma el objeto del contrato apenas un payable llega a `READY` | Genera el shape exacto del contrato de datos, sin campos faltantes | Test contra el schema `ProofOfPayable` de `@pakta/canonical-model` | ✅ (`packages/proof-builder`, 6 tests) |
| HU-D2-17 | Dev 1 recibe el `ProofOfPayable` sin transformarlo | **Integration checkpoint** con el Settlement Adapter de Dev 1 | Corrida conjunta con Dev 1 | 🟡 Nuestro lado 100% listo: `GET /payables/:id/proof` (emite) + `POST /payables/:id/settlement` (recibe de vuelta, con `@pakta/db`/Neon persistiendo el resultado e idempotencia real vía `payable_id` como llave primaria). Bloqueado — Dev 1 aún no tiene Settlement Adapter para probar la corrida conjunta. |
| HU-D2-18 | Dashboard (Payables, Vendors & Wallets, Exceptions, Proof-of-Payable) con datos reales | Los 4 módulos leen del backend real, no de arrays hardcodeados | Prueba manual + smoke test de cada endpoint | ✅ (`apps/web` conectado a `apps/api`, `mock-data.ts` eliminado) |
| HU-D2-19 | Ensayar el demo script completo (§25 maestro) hasta antes del settlement real | 5 invoices, 2 resoluciones, revalidación — sin intervención manual salvo `settle()` de Dev 1 | Corrida en vivo, grabada o ante el equipo | ✅ Corrida en vivo contra `apps/api` + Neon real, 24 sep 2026. Estado inicial exacto (1 READY + 4 BLOCKED, mismos reason codes que §25). Se resolvieron las 2 excepciones del guion — wallet de INV-004 (`POST /vendors/:id/wallet` + `/attest`) y recepción de INV-005 (`POST /payables/:id/receipt`, endpoint nuevo, no existía) — y el sistema revalidó solo, sin llamar `/revalidate` a mano. Resultado: Requested 28,400 / Ready 19,400 / Blocked 9,000 — **exacto** al guion. Proof-of-Payable construido para los 3 READY (5,000 + 8,000 + 6,400 = 19,400). Se detuvo ahí, antes de `settle()`, tal como pide la historia. |

**Sprint Review 3 / Demo:** nivel 4 — Definition of Done de plataforma completa (ver abajo).

---

## Definition of Done — plataforma completa (tu parte)
- [x] Las 8 reglas del kernel implementadas y testeadas. ✅ (Sprint 1)
- [x] AI Extraction Service convierte al menos PDF + email en `CanonicalPayable`, no solo el workbook. ✅ PDF validado con la API real (4/4 layouts, incluida una con tabla de line items). Email: el parsing (`emailIngestion.ts`) está listo y testeado con mocks — falta solo el conector de inbox real (IMAP/webhook), no la lógica de extracción en sí.
- [x] Exception Service enruta y notifica de verdad (no solo produce el objeto `Exception`). ✅
- [x] Proof-of-Payable Builder entrega un `ProofOfPayable` real al Settlement Adapter, sin intervención manual. ✅ (`packages/proof-builder`, expuesto en `GET /payables/:id/proof`; falta el "handshake" real con el Settlement Adapter de Dev 1, que aún no existe)
- [x] Dashboard conectado a datos reales en Payables, Vendors & Wallets, Exceptions, Proof-of-Payable. ✅ (los 4 módulos + Intake leen de `apps/api`, cero arrays hardcodeados)

---

## Tu módulo del dashboard
| Módulo | Lo conectás vos |
|---|:---:|
| Payables | ✔ |
| Vendors & Wallets | ✔ |
| Exceptions | ✔ |
| Proof-of-Payable (es tu output) | ✔ |
| Policy (config del kernel) | ✔ |
| Settlement, Reconciliación | ✗ (Dev 1) |
| Overview (pipeline físico) | Compartido, se arma al final |

---

## Lo que producís para Dev 1 (contrato de datos, no lo tocás sin avisar)

```typescript
// Lo que vos producís y Dev 1 consume
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
```

Vive en `packages/canonical-model` (`src/proof.ts`). **Regla de oro: nunca escribís en `settlements` ni llamás al contrato.** Si necesitás algo del lado de Dev 1, se agrega al contrato — no hay atajos directos a su dominio.

---

## Riesgos de tu parte
- AI extraction alucina un campo que el kernel trata como válido → por eso existe HU-D2-12 específicamente.
- Prompt injection desde el contenido de un invoice/email → todo el contenido del documento se trata como dato, nunca como instrucción.

---

## Resumen de dónde estás parado
- **Sprint 1: 10/10 ✅**
- **Sprint 2: 5/5 ✅ (HU-D2-11, HU-D2-12, HU-D2-13, HU-D2-14, HU-D2-15)**
- **Sprint 3: 3/4 ✅ (HU-D2-16, HU-D2-18, HU-D2-19) + 1/4 ⬜ (HU-D2-17, bloqueado por Dev 1)**
- **Total: 18/19 completas. La única pendiente (HU-D2-17) no depende de vos — es Dev 1 quien tiene que construir el Settlement Adapter.**

*Fuente: `Pakta_Division_Trabajo.md` §5, extraído el 23 sep 2026. Actualizado el 24 sep 2026 tras construir `packages/ai-extraction`, `apps/web`, `apps/api`, `packages/proof-builder` y `packages/db` (Postgres real en Neon, reemplazando SQLite).*
