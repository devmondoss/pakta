# PayableGate — contrato de settlement

Cargo workspace del contrato Soroban. Crate en `payable-contract/`, `soroban-sdk` 27,
compilado y desplegado con Stellar CLI 28.0.0.

```powershell
cd contracts
cargo test --workspace     # 50 tests
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
| `initialize` | admin | Fija issuers, threshold, red, asset, payer, executor y caps. **Una sola vez** |
| `register_payable` | ninguna — la autoridad está en las firmas | Registra una obligación como `Ready` si k-de-n issuers autorizados firmaron su digest |
| `settle` | `executor` | Paga. Único parámetro: `payable_id` |
| `expire` | ninguna | Cierra un payable vencido. Permissionless a propósito |
| `revoke_payable` | admin | Invalida un payable antes de pagarse. Solo puede *frenar* un pago, nunca redirigirlo |
| `attest_lifecycle` | admin | Emite un evento de ciclo de vida. No cambia estado |
| `set_paused` · `set_limits` · `set_proof_issuers` · `set_executor` | admin | Gobernanza |
| `get_payable` · `get_config` · `get_window` | — | Vistas |

## El modelo de custodia es un parámetro, no una bifurcación

`Config.payer` decide de dónde sale el dinero, y ambos modelos de
`Pakta_Plan_Web3_Stellar.md` D1 son el mismo camino de código:

- **`payer` = la address del propio contrato** → modelo vault. El contrato transfiere
  de su saldo fondeado, sin firma humana por pago.
- **`payer` = una cuenta de treasury externa** → esa cuenta debe autorizar cada
  `settle`, porque `transfer` hace `require_auth` sobre su `from`.

Los dos están cubiertos por tests (`test/settle.rs`). Nota operativa del segundo: la
autorización del treasury ocurre en posición **no-raíz** del árbol de auth, así que el
adapter tiene que adjuntar una `SorobanAuthorizationEntry` para el treasury, no solo
firmar el envelope.

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

## Despliegue en testnet

| | |
|---|---|
| **Red** | Stellar Testnet |
| **PayableGate** | `CCF2BKQMKRHOJWUAZPKD72PLWVKHDED6TBOOF7ZJYUXH4OZAOCDLBGON` |
| **Wasm hash** | `0a45b3eb59992209c6d6cc69e499bbe66bc646355d5a07c3732c9817448a36e6` |
| **USDC SAC** | `CAMYM3CR6YM6Y3PUI7NMBJJ3SHWUKDFPRC4C722OOXZG3ZUUFW3ROF5P` |
| **Deploy tx** | [`36e66d1d…32dd2c`](https://stellar.expert/explorer/testnet/tx/36e66d1dc225b47a0e68a3c7e58a3582cb6bd575851ef921b9049b004932dd2c) |
| **Estado** | Desplegado, **sin inicializar** |

Está sin inicializar a propósito: `initialize` es la llamada que elige el modelo de
custodia, y esa decisión sigue abierta con el equipo. El contrato ya responde:

```powershell
stellar contract invoke --id CCF2BKQMKRHOJWUAZPKD72PLWVKHDED6TBOOF7ZJYUXH4OZAOCDLBGON `
  --source deployer --network testnet -- contract_version
# -> 2

stellar contract invoke --id CCF2BKQMKRHOJWUAZPKD72PLWVKHDED6TBOOF7ZJYUXH4OZAOCDLBGON `
  --source deployer --network testnet -- get_config
# -> Error(Contract, #2)  = NotInitialized, el error tipado viajando correctamente
```

Identificadores completos y versionados en [`../deployments/testnet.json`](../deployments/testnet.json).

### Scaffold anterior (HU-D1-01)

`CB5GBGSEAHW3QWVZL25BQU672MHF7UBRAGD4PA3T5V57RQO7LMKJHA2N` — validó la cadena
build → upload → deploy → invoke. Superado por PayableGate, pero se conserva porque el
vector de paridad del `registration_digest` está fijado contra ese contract id.

## Identidades de la CLI

Las identidades de demo y `deployer` viven en el config **global** de Stellar
(`~/.config/stellar/identity/`); la CLI 27.1+ ya no lee el `.stellar/` local del repo.
Las seeds nunca estuvieron ni deben estar en Git.
