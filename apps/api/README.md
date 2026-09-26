# @pakta/api

API Fastify de Pakta. Ingiere Excel y PDF, evalúa payables con el kernel, emite
Proof-of-Payable y coordina el settlement en Stellar. Persiste payables, proofs,
liquidaciones y eventos en PostgreSQL (Neon).

## Configuración

Desde la raíz, crea `.env` siguiendo `.env.example`. `DATABASE_URL` es necesaria
para arrancar. `NVIDIA_API_KEY` habilita la extracción de PDFs. Para liquidar en
testnet configura **ambas** claves: `PAKTA_ISSUER_SECRET` y
`PAKTA_EXECUTOR_SECRET`. El issuer firma el proof y el executor envía la
transacción; sus direcciones deben coincidir con `deployments/testnet.json`.
`PAKTA_NETWORK=testnet` selecciona el manifiesto. Sin esas claves la API sigue
sirviendo intake y consultas, mientras `/health` anuncia settlement `disabled`.

```bash
pnpm --filter @pakta/api dev
```

## Flujo Web3

1. `POST /ingest` persiste el Excel o PDF; `GET /payables` reevalúa las reglas.
2. `GET /payables/:id/proof` devuelve un proof solo si el payable está `READY`.
3. `POST /payables/:id/settle` reevalúa el payable, firma el proof, registra la
   obligación y llama `settle(payable_id)` en el PayableGate. El request **no**
   acepta monto ni destinatario: salen del proof y del estado firmado en cadena.
4. El adapter persiste la transacción y el indexer reconcilia eventos. Consulta
   `GET /payables/:id/settlement`, `GET /settlements/:id` o exporta
   `GET /reconciliation.csv`.

Un segundo `POST /settle` devuelve `ALREADY_SETTLED` y no vuelve a transferir.
Si faltan las claves, devuelve 503. Si el kernel bloquea el payable o la cadena
rechaza la operación, devuelve 409. El endpoint antiguo que aceptaba un `txHash`
de un cliente en `POST /payables/:id/settlement` fue retirado: registrar un pago
sin comprobar el resultado on-chain no es una prueba de liquidación.

## Otros endpoints

| Método | Ruta | Uso |
|---|---|---|
| GET | `/health` | Red, contrato y disponibilidad del settlement |
| POST | `/ingest` | Excel o PDF vía multipart |
| GET | `/policy` | Policy activa |
| GET | `/payables` | Payables con estado actualizado |
| POST | `/payables/:id/revalidate` | Reevaluar un payable |
| POST | `/payables/:id/receipt` | Confirmar recepción |
| GET | `/vendors` | Proveedores y wallets |
| POST | `/vendors/:id/wallet` | Registrar nueva wallet sin atestiguar |
| POST | `/vendors/:id/wallet/attest` | Atestiguar la wallet |
| POST | `/payables/:id/revoke` | Revocar un proof registrado con razón firmada |
| GET | `/vault` | Balance comprometido y disponible |
| POST | `/agent/run` | Ejecutar un ciclo del agente |
| GET | `/summary` | Totales por estado |
| GET | `/activity` | Actividad reciente |
| GET | `/demo/variants` | Variantes de datos de ejemplo |
| POST | `/demo/reset` | Reiniciar datos demo; requiere `PAKTA_DEMO_RESET_ENABLED=true` en el esquema público y settlement desactivado |
| PATCH | `/payables/:id/settlement` | Marcar el estado ERP de una liquidación ya comprobada |

`PAKTA_AGENT_INTERVAL_MS` permite ciclos automáticos; el valor por defecto es
`0`. Las rutas de escritura son para el entorno demo: añade autenticación y
roles de operador antes de exponer esta API públicamente con claves de pago.
`/demo/reset` borra payables y liquidaciones del esquema configurado. Actívalo
solo en una base de datos desechable para la demostración.
