# PayableGate — contrato de settlement

Cargo workspace del contrato Soroban. Crate en `payable-contract/`, `soroban-sdk` 27,
compilado y desplegado con Stellar CLI 28.0.0.

```powershell
cd contracts
cargo test --workspace     # 79 tests
cargo clippy --all-targets # limpio
stellar contract build
```

## La invariante que sostiene todo

**Ninguna función que mueve dinero recibe recipient ni amount.** `settle` toma un
`payable_id` y nada más; el destino y el monto se leen de un estado que un issuer
autorizado firmó al registrar. Un adapter comprometido, un agente confundido o un
prompt injection pueden pedir que se pague *el payable equivocado* — ninguno puede
pedir que se pague *a la wallet equivocada*.

Lo que amarra esa firma es el `registration_digest` (ver `src/digest.rs`): cubre red,
contrato, payable, proof, recipient, asset, monto, policy y expiry. El contrato lo
**recalcula** desde sus propios argumentos y su configuración antes de verificar la
firma, así que sustituir cualquier campo invalida el proof.

## Entry points

| Función | Autorización | Qué hace |
|---|---|---|
| `initialize` | admin | Fija issuers, threshold, red, asset, payer, treasury, executor y caps. **Una sola vez** |
| `register_payable` | ninguna — la autoridad está en las firmas | Registra una obligación como `Ready` si k-de-n issuers autorizados firmaron su digest |
| `settle` | `executor` | Paga. Único parámetro: `payable_id` |
| `expire` | ninguna | Cierra un payable vencido. Permissionless a propósito |
| `revoke_payable` | **firma del issuer** | Invalida un payable antes de pagarse y libera lo comprometido. Solo puede *frenar* un pago, nunca redirigirlo |
| `attest_lifecycle` | admin | Emite un evento de ciclo de vida. No cambia estado |
| `withdraw` | admin | Devuelve float no comprometido al treasury fijado en `initialize` |
| `get_committed` · `get_available` | — | Cuánto está prometido y cuánto puede moverse |
| `set_paused` · `set_limits` · `set_proof_issuers` · `set_executor` | admin | Gobernanza |
| `get_payable` · `get_config` · `get_window` | — | Vistas |

## El modelo de custodia es un parámetro, no una bifurcación

`Config.payer` decide de dónde sale el dinero, y ambos modelos de
`Pakta_Plan_Implementacion.md` §2.5 son el mismo camino de código:

- **`payer` = la address del propio contrato** → modelo vault. El contrato transfiere
  de su saldo fondeado, sin firma humana por pago.
- **`payer` = una cuenta de treasury externa** → esa cuenta debe autorizar cada
  `settle`, porque `transfer` hace `require_auth` sobre su `from`.

Los dos están cubiertos por tests (`test/settle.rs`). Nota operativa del segundo: la
autorización del treasury ocurre en posición **no-raíz** del árbol de auth, así que el
adapter tiene que adjuntar una `SorobanAuthorizationEntry` para el treasury, no solo
firmar el envelope.

## Treasury safety

El saldo del vault no dice nada por sí solo: la mayor parte puede estar ya prometida.
`committed` es la suma de todo payable en `READY`, y **`available = balance - committed`
es lo único que `withdraw` puede tocar**.

| Transición | `committed` | `available` |
|---|---|---|
| `register_payable` | +monto | −monto |
| `settle` | −monto | **sin cambio** — el saldo bajó lo mismo |
| `revoke_payable` | −monto | +monto |
| `expire` | −monto | +monto |

Que `settle` no libere disponibilidad es contraintuitivo y tiene su propio test: la
obligación se extingue, pero el dinero se fue. Los únicos que liberan de verdad son
revocar y expirar.

Dos propiedades más:

- **`withdraw` no tiene parámetro de destino.** Va siempre al treasury fijado en
  `initialize`. Tener la llave de admin permite recuperar el float o frenar el gate,
  no enrutar un solo centavo a una dirección elegida.
- **El vault no puede prometer más de lo que tiene.** `register_payable` rechaza con
  `InsufficientAvailable` en vez de dejar que el faltante aparezca al liquidar, en
  cualquiera que corra último.

> Trampa operativa: el treasury es una cuenta `G...` y **necesita trustline** del asset
> antes de que `withdraw` funcione. Sin ella el transfer falla con `Error(Contract, #13)`.

## Expiry: por qué es permissionless

Un payable vencido sigue reteniendo su monto en `committed` hasta que alguien lo diga.
Un contrato no se entera del paso del tiempo — solo corre cuando lo invocan —, así que
si expirar exigiera autorización, un payable olvidado secuestraría el float para
siempre. Que cualquiera pueda reclamarlo significa que el Settlement Agent, el indexer
o un vendor interesado en que el vault siga solvente pueden hacer la limpieza.

El precio, dicho claro: **`available` solo es exacto una vez que los vencidos se han
expirado de verdad**. Barrerlos es una tarea operativa, no algo que la cadena haga sola.

## Caps de gasto

`max_per_payable` no acota nada en agregado — por eso hay además una ventana rodante
(`window_seconds`, `max_per_window`) que se cobra en la misma llamada que paga.
`set_limits` **no** reinicia el gasto ya registrado en la ventana activa, y eso tiene
su propio test.

## TTL como garantía anti-replay

Un `payable_id` no se puede registrar dos veces solo mientras su entrada exista. Si
se archiva, el id vuelve a ser registrable. Por eso `PAYABLE_TTL_LEDGERS` es ~30 días
y hay un `const _: () = assert!(...)` en `lib.rs` que **no compila** si alguien baja
ese margen.

## Prueba funcional end-to-end

`get_config` solo prueba que el gate quedó configurado. Lo que prueba que el money
path funciona es esto:

```bash
PAKTA_ISSUER_SECRET=$(stellar keys secret pakta_issuer) pnpm testnet:settle
```

El script arma un proof, calcula `proof_hash` con JCS, deriva el `registration_digest`,
lo firma con la llave del issuer, registra, liquida, y comprueba los saldos a ambos
lados. Antes de gastar una transacción verifica que la llave provista sea de verdad el
issuer que el contrato tiene configurado. Corrida real contra testnet:

| Paso | Resultado |
|---|---|
| `register_payable` con firma válida | ✅ `READY` on-chain |
| Mismo proof con recipient sustituido | ✅ rechazado, `Error(Crypto, InvalidInput)` |
| `settle` | ✅ 5000.0000000 USDC exactos, vault → vendor |
| Segundo `settle` del mismo payable | ✅ rechazado, `Error(Contract, #6)` = `NotReady` |
| `settle` desde un caller que no es el executor | ✅ rechazado |
| `withdraw` por encima de `available` | ✅ rechazado, `Error(Contract, #20)` |
| Revocación firmada por el issuer | ✅ `REVOKED`, y liberó lo comprometido |
| `settle` de un payable revocado | ✅ rechazado |
| `withdraw` dentro de lo disponible | ✅ el treasury recibió el monto exacto |

Eventos emitidos, que son lo que consumirá el Event Indexer:

```text
PayableRegistered   payable_id, proof_hash
PayableReady        payable_id, recipient, amount, expiry
transfer            (del SAC) vault -> vendor, USDC:GBGTS43Q…
SettlementExecuted  payable_id, recipient, amount, proof_hash
PayableRevoked      payable_id, reason_code
VaultWithdrawn      treasury, amount
```

`SettlementExecuted` carga el `proof_hash`, así que la cadena tx ↕ settlement ↕ proof
de `Pakta_Documento_Maestro.md` §25 se recorre sin una segunda consulta.

Transacciones de la última corrida: [register](https://stellar.expert/explorer/testnet/tx/51250b4666d5a340d44bf869dd96608dcfe7fc86cf1ae6324752a946a089b733) · [settle](https://stellar.expert/explorer/testnet/tx/ca53d7a7189670d9819c3f6dc9e8c046182ff70f309c9b8681b9f5aa229a8728) · [revoke](https://stellar.expert/explorer/testnet/tx/5d7f235d319bc2e3605ce97319f7537d4df9e60baed5bbb6e4e07c30493bcc23) · [withdraw](https://stellar.expert/explorer/testnet/tx/30cf2855eb663f7a62de1bdadf873259752dfe36c4f26c96888f0b23e5c09c02)

El seed del issuer se pasa por variable de entorno y nunca se escribe en el repo.

## Despliegue en testnet

| | |
|---|---|
| **Red** | Stellar Testnet |
| **PayableGate** | `CDKC6UYM7JFZOIR3DSSHZWSNFB4NTYQ3X3AVJJ5MIU3UH6H4NBQON5GB` (v3) |
| **Wasm hash** | `28314459f6e83e34bf9cc5128d31b76d4a0a863f0ee17b1084a2ddc1c6d679eb` |
| **USDC SAC** | `CAMYM3CR6YM6Y3PUI7NMBJJ3SHWUKDFPRC4C722OOXZG3ZUUFW3ROF5P` |
| **Initialize tx** | [`1a57e1f2…92cfbf`](https://stellar.expert/explorer/testnet/tx/1a57e1f27423d488f2e8d710e680c99cdff0f86a4d7bd471cff6631a5792cfbf) |
| **Estado** | Inicializado como vault con caps, fondeado con 100 000 USDC |

La decisión de custodia ya está tomada para el demo: el **v3** está inicializado
como vault y fondeado. Para consultar su configuración, usa el ID vigente del
manifiesto:

```powershell
stellar contract invoke --id CDKC6UYM7JFZOIR3DSSHZWSNFB4NTYQ3X3AVJJ5MIU3UH6H4NBQON5GB `
  --source deployer --network testnet -- get_config
```

`CCF2BKQMKRHOJWUAZPKD72PLWVKHDED6TBOOF7ZJYUXH4OZAOCDLBGON` es el v2
supersedido. Se conserva únicamente como referencia histórica y no debe usarse
para registrar ni liquidar payables.

Identificadores completos y versionados en [`../deployments/testnet.json`](../deployments/testnet.json).

### Scaffold anterior (HU-D1-01)

`CB5GBGSEAHW3QWVZL25BQU672MHF7UBRAGD4PA3T5V57RQO7LMKJHA2N` — validó la cadena
build → upload → deploy → invoke. Superado por PayableGate, pero se conserva porque el
vector de paridad del `registration_digest` está fijado contra ese contract id.

## Identidades de la CLI

Las identidades de demo y `deployer` viven en el config **global** de Stellar
(`~/.config/stellar/identity/`); la CLI 27.1+ ya no lee el `.stellar/` local del repo.
Las seeds nunca estuvieron ni deben estar en Git.
