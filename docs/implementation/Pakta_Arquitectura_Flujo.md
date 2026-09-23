# Pakta — Esquema y Flujo Técnico

**Checkpoint intermedio — hackathon**
**Fecha:** 23 de septiembre de 2026
**Repositorio:** https://github.com/devmondoss/pakta

> Qué problema resolvemos, cómo se resuelve hoy sin Pakta, cómo lo resuelve Pakta, el pipeline técnico completo, el stack y qué está construido hasta este checkpoint. Documentación completa: [`product/Pakta_Documento_Maestro.md`](../product/Pakta_Documento_Maestro.md) · [`implementation/Pakta_Plan_Implementacion.md`](Pakta_Plan_Implementacion.md) · [`implementation/Pakta_Division_Trabajo.md`](Pakta_Division_Trabajo.md).

---

## 1. El problema

Una SME tiene los mismos problemas de Accounts Payable que una gran empresa —facturas duplicadas, órdenes de compra que no cuadran, recepciones sin confirmar, cambios de wallet/cuenta bancaria del proveedor, aprobaciones pendientes, reconciliación manual— pero no tiene el stack de SAP/AWS/Bitwave para resolverlos. La evidencia vive repartida en Excel, PDFs, correos y, cuando existe, un software contable. Nadie tiene una vista única de "¿esta obligación está realmente lista para pagarse?" antes de que el dinero salga.

### Flujo tradicional (sin Pakta)

```mermaid
flowchart LR
    A1["📧 Invoice llega<br/>por PDF o email"] --> B1["👤 AP la revisa<br/>a mano"]
    B1 --> C1["🔍 Busca la PO<br/>en otro sistema/Excel"]
    C1 --> D1["📞 Pregunta a Operations<br/>si el servicio llegó"]
    D1 --> E1["📋 Busca el approval<br/>en otro hilo de correo"]
    E1 --> F1{"¿Todo cuadra?"}
    F1 -->|"no está seguro"| G1["⏳ Retrasa semanas<br/>o paga igual 'para no atrasar'"]
    F1 -->|"cree que sí"| H1["💸 Paga manualmente"]
    G1 --> H1
    H1 --> I1["📊 Reconcilia a mano<br/>en Excel, días después"]
    I1 --> J1["🚨 Duplicado, wallet<br/>equivocada o fraude<br/>se descubre tarde"]

    classDef pain fill:#f6c9c4,stroke:#b73b3b,color:#5a1414
    class A1,B1,C1,D1,E1,G1,I1,J1 pain
```

**El costo real:** 63% de equipos de AP dedica más de 10 horas/semana a procesar invoices, 66% todavía hace entrada manual al ERP (IFOL, 2025), y 79% de organizaciones sufrió intentos de fraude de pagos en 2024 (AFP, 2025) — buena parte por cambios de cuenta/wallet del proveedor no verificados.

---

## 2. La solución — Pakta

Pakta se conecta con la evidencia que la empresa **ya tiene** (Excel, PDFs, email), usa AI para leerla y relacionarla, pero **nunca deja que un modelo probabilístico autorice un pago**: un motor de reglas determinístico decide si el payable está listo, y solo entonces se emite un **Proof-of-Payable** que habilita el settlement en Stellar. Cuando algo no cuadra, no es un error genérico — es una excepción tipada con dueño y acción exacta, que se revalida sola en cuanto se resuelve.

### Flujo propuesto (con Pakta)

```mermaid
flowchart LR
    A1["📊 Excel / CSV"] --> ING["Ingestion Service"]
    A2["📧 PDF / Email"] --> AI["AI Extraction"]
    ING --> CPM["Canonical Payable Model"]
    AI --> CPM
    CPM --> KER["Deterministic<br/>Control Kernel"]
    KER -->|"❌ excepción"| EXC["Exception Service<br/>dueño + acción exacta"]
    EXC -->|"resuelto"| KER
    KER -->|"✅ listo"| PRF["Proof-of-Payable<br/>Builder"]
    PRF --> SET["Settlement Adapter"]
    SET --> SC["Soroban Contract"]
    SC --> STL[("Stellar<br/>USDC")]
    STL --> IDX["Event Indexer"]
    IDX --> REC["Reconciliación<br/>de vuelta al Excel/ERP"]

    classDef good fill:#dff0e6,stroke:#177a51,color:#0d3d29
    class ING,AI,CPM,KER,EXC,PRF,SET,SC,STL,IDX,REC good
```

> **La diferencia:** el payment rail responde "¿podemos mover el dinero?". Pakta responde **"¿esta obligación específica está realmente lista para pagarse, a este destinatario, por este monto, ahora?"** — antes de que el dinero se mueva, no después.

---

## 3. Pipeline técnico end-to-end

Mismo flujo de arriba, ahora con el detalle de quién construye cada bloque (ver `Pakta_Division_Trabajo.md`): **Dev 2** posee todo lo anterior al Proof-of-Payable, **Dev 1** todo lo posterior.

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

## 4. Qué hemos construido hasta este checkpoint

```mermaid
flowchart LR
    A1["Excel / CSV"] --> B["Ingestion Service"]
    A2["PDF"] --> C["AI Extraction"]
    A3["Email"] --> C
    B --> D["Canonical Payable Model"]
    C --> D
    D --> E["Deterministic Control Kernel"]
    E -->|blocked| F["Exception Service<br/>routing/notificaciones"]
    F --> E
    E -->|ready| G["Proof-of-Payable Builder"]
    G --> H["Settlement Adapter"]
    H --> I["Soroban Contract"]
    I --> J[("Stellar / USDC")]
    J --> K["Event Indexer"]
    K --> L["Reconciliación"]

    classDef built fill:#1a9c6b,stroke:#0d5c3f,color:#ffffff,font-weight:bold
    classDef nextup fill:#e3a94f,stroke:#8a5f10,color:#2b1c00,font-weight:bold
    classDef planned fill:#c7cbd1,stroke:#5c6270,color:#1b1d24

    class A1,B,D,E built
    class A2,A3,C,F,G nextup
    class H,I,J,K,L planned
```

🟢 **Construido y testeado** (`tonny-dev` → `main`, 45/45 tests) · 🟠 **Siguiente en la fila** · ⚪ **Planeado**

| Módulo | Estado | Detalle |
|---|:---:|---|
| Ingestion Service (`@pakta/ingestion`) | 🟢 | `.xlsx`/`.csv` → Canonical Payable Model, ExcelJS, rechazo fila-por-fila sin abortar el batch |
| Canonical Payable Model (`@pakta/canonical-model`) | 🟢 | Schemas Zod (Vendor, PO, Invoice, Receipt, Approval, Exception) + contrato `ProofOfPayable`/`Settlement` compartido con Dev 1 |
| Deterministic Control Kernel (`@pakta/rules-kernel`) | 🟢 | Las 8 reglas de §7.3, mapeadas 1:1 a `reason_code`/`owner_role`/`required_action` de §10 |
| Fixture del demo canónico (5 invoices, 28,400 USDC) | 🟢 | End-to-end: 1 READY + 4 BLOCKED exactos, reproducible con `pnpm test` |
| AI Extraction Service (PDF/email → structured output) | 🟠 | Semana 2 |
| Exception Service (routing/notificaciones reales) | 🟠 | Semana 2 — hoy el kernel produce el objeto `Exception`, falta el enrutamiento/notificación |
| Proof-of-Payable Builder | 🟠 | Semana 3 |
| Soroban Contract (`payable-contract`) | ⚪ | Dev 1 — no iniciado en este checkpoint |
| Settlement Adapter + Event Indexer | ⚪ | Dev 1 |
| Dashboard conectado a datos reales | ⚪ | Mockup ya prototipado, falta conectar a la API |

**Resultado verificable hoy:**
```bash
pnpm install
pnpm test        # 45/45 passed
pnpm typecheck    # clean
```
Corre el fixture canónico de 5 invoices y produce, de forma determinística, 1 payable `READY` + 4 `BLOCKED` con el `reason_code`/`owner_role`/`required_action` exactos del documento maestro.

---

## 5. Máquina de estados del `Payable`

Coherente entre lo que corre en `@pakta/rules-kernel` (off-chain, ya construido) y lo que va a aplicar el contrato Soroban (on-chain, Dev 1).

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

## 6. Secuencia del demo canónico (5 invoices, `fixtures/demo-workbook`)

Corrida real contra el fixture ya implementado — no es hipotética, es el test de aceptación `demo-fixture.test.ts`.

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

## 7. Modelo de datos — Canonical Payable Model

Implementado en `@pakta/canonical-model` (`packages/canonical-model/src/schemas.ts`, `exception.ts`, `proof.ts`).

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

## 8. Stack técnico

| Capa | Tecnología | Estado |
|---|---|:---:|
| Modelo de datos compartido | TypeScript + Zod 4.6.5 (`@pakta/canonical-model`) | 🟢 |
| Ingestion (Excel/CSV → Canonical Payable Model) | ExcelJS 4.4.0 (`@pakta/ingestion`) | 🟢 |
| Deterministic Control Kernel | TypeScript puro, decimal.js (`@pakta/rules-kernel`) | 🟢 |
| Policy config | YAML (`js-yaml`) validado con Zod en el borde | 🟢 |
| AI Extraction Service | Claude (structured output / tool use) | 🟠 |
| Exception Service (routing/notificaciones) | Fastify + BullMQ (planeado) | 🟠 |
| Proof-of-Payable Builder | TypeScript (`@pakta/canonical-model` types) | 🟠 |
| Smart contract | Soroban / Rust (`contracts/payable-contract`) | ⚪ |
| Settlement | Stellar SDK + Stellar CLI, USDC/SAC, testnet | ⚪ |
| Event Indexer | Stellar RPC `getEvents` | ⚪ |
| Base de datos | PostgreSQL (Supabase) | ⚪ |
| Runtime / tooling | Node 24, pnpm 12.6.0 (workspaces), TypeScript 7.0.2, Vitest 5.0.1 | 🟢 |
| Frontend / dashboard | Next.js + React | 🎨 mockup listo, falta conectar |

---

## 9. Próximo paso

Dev 1 arranca `contracts/payable-contract` (Soroban): estado mínimo del `Payable`, los 7 entry points (`register_payable`, `submit_proof`, `block_payable`, `resolve_exception`, `revalidate`, `settle`, `expire`) y los invariantes de no-doble-settlement / no-sustitución de recipient-amount. Deploy de un esqueleto a testnet como primer hito verificable. En paralelo, Dev 2 conecta AI Extraction (Claude) para PDF/email y arma el Exception Service real.
