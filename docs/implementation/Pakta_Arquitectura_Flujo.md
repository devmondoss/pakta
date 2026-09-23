# Pakta — Arquitectura y Flujo Técnico

**Checkpoint intermedio — hackathon**
**Fecha:** 23 de septiembre de 2026
**Repositorio:** https://github.com/devmondoss/pakta

> Esquema y flujo de lo que estamos construyendo: pipeline end-to-end, máquina de estados del payable, secuencia del demo canónico, modelo de datos y stack. Referencia completa: [`product/Pakta_Documento_Maestro.md`](../product/Pakta_Documento_Maestro.md) · [`implementation/Pakta_Plan_Implementacion.md`](Pakta_Plan_Implementacion.md) · [`implementation/Pakta_Division_Trabajo.md`](Pakta_Division_Trabajo.md).

---

## 1. Pipeline end-to-end

De la evidencia cruda (Excel, PDF, email) a un settlement verificable en Stellar y de vuelta a reconciliation. Los subgrafos marcan quién construye cada bloque (ver `Pakta_Division_Trabajo.md`).

```mermaid
flowchart LR
    subgraph SRC["Evidencia de entrada"]
        A1[Excel / CSV<br/>VENDORS · PO · INVOICES · RECEIPTS · APPROVALS]
        A2[PDF de invoice]
        A3[Email]
    end

    subgraph DEV2["Dev 2 — Agentic / AI Workflows"]
        B["Ingestion Service<br/>@pakta/ingestion"]
        C["AI Extraction Service<br/>Claude structured output"]
        D["Canonical Payable Model<br/>@pakta/canonical-model"]
        E["Deterministic Control Kernel<br/>@pakta/rules-kernel — 8 reglas §7.3"]
        F["Exception Service<br/>reason_code + owner + required_action"]
        G["Proof-of-Payable Builder"]
    end

    subgraph DEV1["Dev 1 — Web3 / Settlement"]
        H["Settlement Adapter<br/>SAC / x402 / MPP"]
        I["Soroban Contract<br/>payable-contract"]
        J[("Stellar Testnet<br/>USDC / SAC")]
        K["Event Indexer Worker"]
    end

    L["Reconciliation Export<br/>de vuelta a Excel/CSV"]

    A1 --> B
    A2 --> C
    A3 --> C
    B --> D
    C --> D
    D --> E
    E -- "BLOCKED (typed exception)" --> F
    F -- "owner resuelve → revalidate" --> E
    E -- "READY (0 exceptions)" --> G
    G --> H --> I --> J
    J --> K --> L
    L -. "estado visible" .-> CFO(["CFO / Finance Ops"])
```

---

## 2. Máquina de estados del `Payable`

Un único state machine, coherente entre lo que corre en `@pakta/rules-kernel` (off-chain) y lo que va a aplicar el contrato Soroban (on-chain, capa de Dev 1).

```mermaid
stateDiagram-v2
    [*] --> VERIFYING: ingestWorkbook() → register_payable()

    VERIFYING --> READY: kernel — 0 exceptions
    VERIFYING --> BLOCKED: kernel — ≥1 exception

    BLOCKED --> RESOLUTION_PENDING: owner resuelve (resolve_exception)
    RESOLUTION_PENDING --> READY: revalidate() — 0 exceptions
    RESOLUTION_PENDING --> BLOCKED: revalidate() — sigue fallando

    READY --> SETTLED: settle() [Soroban, atómico]

    VERIFYING --> EXPIRED: expire()
    BLOCKED --> EXPIRED: expire()
    READY --> EXPIRED: expire()

    SETTLED --> [*]
    EXPIRED --> [*]

    note right of READY
        SETTLING no se persiste: Soroban
        es atómico, no hay estado
        intermedio observable entre
        READY y SETTLED.
    end note
```

---

## 3. Secuencia del demo canónico (5 invoices, `fixtures/demo-workbook`)

Corrida real contra el fixture ya implementado — no es hipotética, es el test de aceptación `demo-fixture.test.ts` (45/45 tests en verde a la fecha de este checkpoint).

```mermaid
sequenceDiagram
    actor CFO as CFO / Finance
    participant ING as Ingestion Service
    participant KER as Rules Kernel
    participant OWN as Exception Owners
    participant PRF as Proof Builder
    participant SET as Settlement (Soroban)
    participant REC as Reconciliation

    CFO->>ING: "Pay every valid invoice due today"
    ING->>ING: ingestWorkbook(demo-workbook.xlsx)
    ING-->>KER: 5 CanonicalPayable (28,400 USDC)
    KER->>KER: evaluateBatch()

    KER-->>PRF: INV-001 READY (5,000)
    KER-->>OWN: INV-002 DUPLICATE_INVOICE → Accounts Payable
    KER-->>OWN: INV-003 PO_AMOUNT_MISMATCH → Procurement
    KER-->>OWN: INV-004 VENDOR_WALLET_CHANGED → Vendor Master
    KER-->>OWN: INV-005 MISSING_RECEIPT → Operations

    PRF->>SET: ProofOfPayable(INV-001)
    SET->>SET: settle()
    SET-->>REC: Settlement(tx_hash, ledger)

    OWN->>OWN: Vendor Master reverifica wallet (INV-004)
    OWN->>OWN: Operations confirma receipt (INV-005)
    OWN->>KER: revalidate(INV-004), revalidate(INV-005)
    KER-->>PRF: INV-004 READY, INV-005 READY

    PRF->>SET: ProofOfPayable × 2
    SET->>SET: settle() × 2
    SET-->>REC: Settlement × 2

    REC-->>CFO: 3/5 settled (19,400) · 2 pendientes (9,000) · 0 no autorizados
```

---

## 4. Modelo de datos — Canonical Payable Model

Implementado en `@pakta/canonical-model` (Zod, en `packages/canonical-model/src/schemas.ts`, `exception.ts`, `proof.ts`).

```mermaid
erDiagram
    VENDOR {
        string vendorId
        string legalName
        string verificationStatus
    }
    VENDOR_WALLET {
        string address
        string attestationStatus
        int version
    }
    PURCHASE_ORDER {
        string poId
        string amount
        string status
    }
    INVOICE {
        string invoiceId
        string amount
        date dueDate
        string walletAddress
    }
    RECEIPT {
        number confirmedQty
        number invoicedQty
    }
    APPROVAL {
        string objectType
        string approverId
    }
    CANONICAL_PAYABLE {
        string payableId
        string policyVersion
    }
    EXCEPTION {
        string reason
        string severity
        string ownerRole
        string requiredAction
    }
    PROOF_OF_PAYABLE {
        string proofHash
        string status
        string expiresAt
    }
    SETTLEMENT {
        string txHash
        int ledger
        string erpPostingStatus
    }

    VENDOR ||--o{ VENDOR_WALLET : has
    VENDOR ||--o{ PURCHASE_ORDER : issues
    VENDOR ||--o{ INVOICE : bills
    PURCHASE_ORDER ||--o{ RECEIPT : confirms
    PURCHASE_ORDER ||--o{ APPROVAL : requires
    INVOICE ||--o| PURCHASE_ORDER : references
    INVOICE ||--|| CANONICAL_PAYABLE : becomes
    CANONICAL_PAYABLE ||--o{ EXCEPTION : may_produce
    CANONICAL_PAYABLE ||--o| PROOF_OF_PAYABLE : may_produce
    PROOF_OF_PAYABLE ||--|| SETTLEMENT : settles_into
```

`ProofOfPayable` y `Settlement` son el **único contrato compartido** entre Dev 1 y Dev 2 (`Pakta_Division_Trabajo.md` §5) — viven en `@pakta/canonical-model` para que nadie los reinvente de un lado u otro.

---

## 5. Stack técnico

| Capa | Tecnología | Estado |
|---|---|---|
| Modelo de datos compartido | TypeScript + Zod 4.6.5 (`@pakta/canonical-model`) | ✅ Construido |
| Ingestion (Excel/CSV → Canonical Payable Model) | ExcelJS 4.4.0 (`@pakta/ingestion`) | ✅ Construido |
| Deterministic Control Kernel | TypeScript puro, decimal.js (`@pakta/rules-kernel`) | ✅ Construido — 8 reglas de §7.3 |
| Policy config | YAML (`js-yaml`) validado con Zod en el borde | ✅ Construido |
| AI Extraction Service | Claude (structured output / tool use) | ⏳ Semana 2 |
| Exception Service (routing/notificaciones) | Fastify + BullMQ (planeado) | ⏳ Semana 2 |
| Proof-of-Payable Builder | TypeScript (`@pakta/canonical-model` types) | ⏳ Semana 3 |
| Smart contract | Soroban / Rust (`contracts/payable-contract`) | ⏳ Dev 1 — no iniciado en este checkpoint |
| Settlement | Stellar SDK + Stellar CLI, USDC/SAC, testnet | ⏳ Dev 1 |
| Event Indexer | Stellar RPC `getEvents` | ⏳ Dev 1 |
| Base de datos | PostgreSQL (Supabase) | ⏳ Semana 2 |
| Runtime / tooling | Node 24, pnpm 12.6.0 (workspaces), TypeScript 7.0.2, Vitest 5.0.1 | ✅ Configurado |
| Frontend / dashboard | Next.js + React (mockup ya prototipado, pendiente de conectar a datos reales) | 🎨 Mockup listo |

---

## 6. Estado actual del repo (este checkpoint)

```text
pakta/
├── docs/                         # tesis de producto, plan, división de trabajo
├── packages/
│   ├── canonical-model/          # ✅ schemas Zod + contrato ProofOfPayable/Settlement
│   ├── ingestion/                # ✅ ingestWorkbook() — xlsx/csv → Canonical Payable Model
│   └── rules-kernel/             # ✅ evaluatePayable/evaluateBatch — 8 reglas + reason codes
├── fixtures/demo-workbook/       # ✅ dataset canónico de 5 invoices (28,400 USDC)
├── contracts/                    # ⏳ payable-contract (Soroban) — pendiente, Dev 1
└── apps/                         # ⏳ api (Fastify) + web (dashboard) — pendiente
```

**Resultado verificable hoy:** correr el fixture canónico de 5 invoices produce, de forma determinística, **1 payable READY + 4 BLOCKED** con el `reason_code`/`owner_role`/`required_action` exactos del documento maestro — 45/45 tests en verde, typecheck limpio.

```bash
pnpm install
pnpm test        # 45/45 passed
pnpm typecheck    # clean
```

---

## 7. Próximo paso

Dev 1 arranca `contracts/payable-contract` (Soroban): estado mínimo del `Payable`, los 7 entry points (`register_payable`, `submit_proof`, `block_payable`, `resolve_exception`, `revalidate`, `settle`, `expire`) y los invariantes de no-doble-settlement / no-sustitución de recipient-amount. Deploy de un esqueleto a testnet como primer hito verificable.
