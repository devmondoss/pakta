# @pakta/api

Fastify backend for Pakta. Serves the real pipeline (ingestion → deterministic
control kernel → exceptions → Proof-of-Payable) over HTTP, backed by Postgres
(Neon).

## Running it

```bash
pnpm dev      # tsx watch, auto-loads the monorepo root .env
```

Needs `DATABASE_URL` (Neon connection string) in the root `.env`. Everything
else has sane defaults — see `.env.example` at the repo root.

## For Dev 1 (Settlement Adapter integration) — start here

This is the whole contract. Two endpoints, one in each direction.

### 1. `GET /payables/:payableId/proof` — what you consume

Call this once a payable shows `status: "READY"` on `GET /payables`. Returns
the exact `ProofOfPayable` shape from `@pakta/canonical-model` — nothing to
transform.

```bash
curl http://localhost:4000/payables/PAY-INV-001/proof
```

```json
{
  "payable_id": "PAY-INV-001",
  "invoice_hash": "sha256:demo-inv-001",
  "po_hash": "sha256:9b13a227...",
  "vendor_id": "VEN-001",
  "vendor_wallet": "GA1CD9F3KXQPLMN7R2WZT8VY",
  "wallet_attestation_version": 1,
  "amount": "5000.00",
  "asset": "USDC",
  "policy_version": "FIN-4.2",
  "approvals_hash": "sha256:65c5bb42...",
  "cost_center": "UNSPECIFIED",
  "expires_at": "2026-09-27T00:11:39.601Z",
  "status": "READY"
}
```

- **409** if the payable isn't actually READY (kernel would still block it) —
  never build a proof for anything that isn't this response's own `READY`.
- **404** if the payable doesn't exist.
- `expires_at` is real — revalidate before `settle()` if it's close to or
  past that timestamp.
- `cost_center` is always `"UNSPECIFIED"` for now (not wired into the
  canonical model yet) — don't branch logic on it.

### 2. `POST /payables/:payableId/settlement` — what you report back

Call this once you've actually executed the transfer on Stellar. This is what
closes the loop — until you call it, we have no idea settlement happened,
and the payable would still look "pending" to Ops/AP forever.

```bash
curl -X POST http://localhost:4000/payables/PAY-INV-001/settlement \
  -H "content-type: application/json" \
  -d '{
    "asset": "USDC",
    "amount": "5000.00",
    "txHash": "<the real Stellar tx hash>",
    "ledger": 12345678,
    "erpPostingStatus": "PENDING"
  }'
```

Returns the `Settlement` shape:

```json
{
  "payable_id": "PAY-INV-001",
  "invoice_id": "INV-001",
  "po_id": "PO-72881",
  "settlement": {
    "network": "stellar",
    "asset": "USDC",
    "amount": "5000.00",
    "tx_hash": "<the real Stellar tx hash>",
    "ledger": 12345678
  },
  "status": "SETTLED",
  "erp_posting_status": "PENDING"
}
```

- **Idempotent**: `payable_id` is the primary key in the `settlements` table.
  Call it twice by accident and the second call **409**s — it will never
  double-record a settlement. Safe to retry on ambiguous network failures as
  long as you check for 409 = "already recorded, you're fine."
- **409** if the payable isn't READY (refuses a settlement for something the
  kernel would still block).
- **400** if `asset`/`amount`/`txHash`/`ledger` (number) are missing, or
  `erpPostingStatus` isn't one of `PENDING` / `RECONCILED` / `FAILED`
  (defaults to `PENDING` if omitted).
- Also feeds the vendor+amount fingerprint into
  `settled_invoice_fingerprints` — the kernel's own duplicate-detection rule
  (`PAYMENT_ALREADY_SETTLED`) will now catch any *other* payable that
  matches the same vendor/amount, not just this exact one.

Once this call succeeds, `GET /payables` reports that payable as
`"status": "SETTLED"` immediately — no cache to invalidate.

`GET /payables/:payableId/settlement` reads it back (404 if unsettled).

## Every endpoint

| Method | Path | What it does |
|---|---|---|
| GET | `/health` | Liveness check |
| POST | `/ingest` | Ingesta un `.xlsx` o PDF vía `multipart/form-data`; el PDF se valida contra fuentes conocidas antes de persistirse. |
| GET | `/policy` | Devuelve la policy determinística activa. |
| GET | `/payables` | Payables persistidos, evaluados en vivo (la primera ejecución siembra los cinco del demo). |
| GET | `/payables/:id/proof` | Builds a `ProofOfPayable` — 409 if not READY |
| POST | `/payables/:id/revalidate` | Re-runs the kernel now, returns the fresh result |
| GET | `/payables/:id/settlement` | Reads back a recorded settlement — 404 if none |
| POST | `/payables/:id/settlement` | **Dev 1 → us.** Records a settlement. See above. |
| POST | `/payables/:id/receipt` | Confirms delivery for the payable's PO — clears `MISSING_RECEIPT`/`PARTIAL_RECEIPT` |
| GET | `/vendors` | Vendors + their current wallet/attestation |
| POST | `/vendors/:id/wallet` | Registers a new payout address (UNATTESTED) |
| POST | `/vendors/:id/wallet/attest` | Confirms the wallet on file — clears `VENDOR_WALLET_CHANGED`/`UNATTESTED_WALLET` |
| GET | `/summary` | Aggregate totals (requested/ready/blocked/settled) |

Everything except the two contract endpoints above is Dev 2's own dashboard
plumbing — useful for context, not something Dev 1 needs to call.
