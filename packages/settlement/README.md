# @pakta/settlement

El lado on-chain del backend: convierte la decisión `READY` del kernel en dinero en la
cuenta del vendor, sobre el PayableGate de Soroban.

## Piezas

| Módulo | Qué hace |
|---|---|
| `registration.ts` | `prepareRegistration`: proof v1.1 → argumentos exactos de `register_payable` + el digest que firma el issuer. Toda conversión (decimal→i128, ISO→u64, StrKey→bytes) vive aquí |
| `issuer.ts` | `Issuer` firma registros, revocaciones y atestaciones. `verifySignedProof` comprueba un sobre como lo hará el contrato, antes de gastar una transacción |
| `chain.ts` | `SorobanGateClient`: el único que habla RPC. Firma en proceso con la llave del executor |
| `adapter.ts` | `SettlementAdapter`: lleva un proof firmado hasta el pago, de forma idempotente |
| `indexer.ts` | `EventIndexer`: proyecta los eventos del gate; reconciliación independiente |
| `agent.ts` | `SettlementAgent`: el loop autónomo |
| `fakeGate.ts` | Doble de pruebas con las reglas reales del contrato, firma ed25519 incluida |

## Idempotencia

La cadena es la fuente de verdad. Antes de actuar, el adapter lee el estado on-chain y
hace solo lo que falta:

```text
ausente  -> register + settle
READY    -> settle
SETTLED  -> nada (ALREADY_SETTLED)
EXPIRED / REVOKED -> se rechaza
```

Un reintento tras un crash, un settle cuya respuesta se perdió, o dos procesos
compitiendo convergen en un solo pago. Si el registro local falta, se reconstruye
desde el evento on-chain guardado.

## Dos llaves, a propósito

| Variable | Rol | Qué *no* puede hacer |
|---|---|---|
| `PAKTA_ISSUER_SECRET` | Firma digests de proof | Enviar transacciones ni mover dinero |
| `PAKTA_EXECUTOR_SECRET` | Envía y paga transacciones; es el executor del gate | Inventar un payable: solo liquida lo que el issuer firmó |

Ninguna de las dos basta sola para dirigir dinero.

## Hallazgos contra testnet

- **El RPC pagina escaneando un rango acotado de ledgers.** Una página puede volver
  vacía con el cursor avanzado. El indexer pagina hasta que el cursor deja de moverse.
- **Un evento visto antes de conocer su proof** quedaba como no atribuible y, al
  deduplicarse, nunca se revisaba. El adapter ahora reconstruye ese settlement desde el
  evento cuando encuentra el payable ya `SETTLED`.
