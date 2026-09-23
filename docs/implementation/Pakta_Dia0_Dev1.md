# Dev 1 — Día 0: entrega y propuesta para Dev 2

**Fecha:** 23-sep-2026 · **Estado:** trabajo local completado; acuerdo de datos y decisiones de equipo pendientes.

## 1. Relectura de todos los Markdown y del código

Se revisaron `README.md`, `docs/README.md`, el documento maestro, el plan de implementación, la división de trabajo, arquitectura/flujo y el plan Web3, además de `packages/canonical-model/src/proof.ts` y el fixture real. La división de trabajo §3 y §6 exige editar el contrato de datos **en pareja**. Por eso esta propuesta todavía no cambia `proof.ts` ni `demo-data.json`.

| Hallazgo | Decisión o acción Día 0 |
|---|---|
| Los documentos maestros afirman «sin custodia», pero el vault propuesto retiene tokens | Presentar a ambos devs la decisión de custodia. Si se elige vault, documentar que custodia un saldo acotado y que treasury controla fondeo, retiros y caps. |
| `max_per_payable` no limita el total de pagos | Diseñar cap agregado por ventana, `paused`, pruebas de límites y mecanismo de retiro antes de fondear el vault. |
| Firma sobre `proof_hash` aislado no vincula los argumentos que recibe el contrato | Firmar un **digest de registro** que incluye hash del proof y todos los parámetros on-chain. El contrato debe recalcularlo. |
| `payable_id` en storage anti-replay tiene TTL | Retener y renovar el marcador de ID usado; especificar duración del vault. Si vence, re-registro vuelve a ser posible. |
| `settle(payable_id)` abierto a cualquiera permite saltarse la revalidación off-chain de §14.3 | Mantener la firma de función con solo `payable_id`, pero exigir `Config.executor.require_auth()` y añadir `revoke_payable(payable_id)` autorizado por el issuer que impida pagar un proof invalidado. Probar revocación y executor no autorizado. |
| El plan habla de firmas threshold, pero solo enumera firmas sin identificar autores | Cada firma debe llevar `issuer_public_key`; contar únicamente issuers permitidos y distintos. MVP puede fijar threshold = 1. |
| §8.5 del maestro enumera seis eventos; el plan incluye `payable_revalidated` y omite `payable_reconciled` | Acordar el catálogo exacto. Los eventos de ciclo de vida son testimonios firmados del issuer, no una prueba de reglas ejecutadas on-chain. |
| El plan supone que un intento bloqueado por MCP deja evento en testnet | Solo hay tx hash si se envía una transacción. Una invocación fallida no deja evento contractual persistente. Registrar rechazo en adapter y mostrar resultado de tx si llegó a la red. |
| La CLI instalada es Stellar 27.1, y `stellar contract init` usa `soroban-sdk = "27"` | Scaffold real alineado con esa versión; el plan anterior decía 26. |
| Los `G...` del fixture son placeholders inválidos | Se generaron seis cuentas de testnet: cinco vendors y un destino alternativo para `INV-004`. Las direcciones públicas están en `fixtures/stellar-testnet-addresses.json`. |
| Fondear las `G...` con Friendbot solo entrega XLM; una cuenta receptora de USDC emitido necesita trustline autorizada | Crear trustlines del asset de demo en Semana 2 antes de cualquier `settle`, y probar un pago SAC a una cuenta `G...`. [Referencia Stellar](https://developers.stellar.org/docs/tokens/stellar-asset-contract). |

## 2. Propuesta única `ProofOfPayable` v1.1 — para negociar con Dev 2

### Forma del objeto

`unsigned_proof` contiene exactamente los campos actuales de `ProofOfPayable` más `receipt_hash`. Se exige `status: "READY"`, `amount` decimal positivo sin exponente y con hasta siete decimales, `expires_at` en UTC sin fracciones (`YYYY-MM-DDTHH:mm:ssZ`), y `vendor_wallet` como Stellar account ID `G...` válido. Los hashes de evidencia deben tener una codificación acordada (propuesta: 64 hex minúsculos, sin `0x`). Los placeholders como `sha256:demo-inv-001` son solo datos de prueba del kernel y no se pueden firmar como evidencia real.

El envoltorio firmado agrega estos campos al tipo compartido:

```ts
type SignedProofV11 = UnsignedProof & {
  proof_hash: string;          // 64 hex minúsculos: SHA-256(JCS(unsigned_proof))
  issuer_public_key: string;   // Stellar G... del issuer autorizado
  issuer_signature: string;    // base64 de 64 bytes Ed25519
  network_passphrase: string;  // Test SDF Network ; September 2015
  contract_id: string;         // C... del PayableGate de esta red
};
```

`Settlement` agrega `proof_hash` y `contract_id` para reconciliación. `payer` se obtiene de la configuración del vault. `payable_id` es el identificador de un solo uso; no se agrega otro `nonce` hasta que haya un caso de reemisión definido. La forma exacta, validaciones Zod y migración del fixture necesitan aprobación conjunta.

### Dos hashes distintos y sus responsabilidades

1. `proof_hash = SHA-256(UTF-8(JCS(unsigned_proof)))` según RFC 8785. Se calculan **solo** los campos del payload, nunca `proof_hash`, firma ni metadata de despliegue. Dev 2 firma únicamente después de ejecutar el kernel. El adapter vuelve a calcular este hash desde el objeto recibido y rechaza cualquier diferencia.
2. `registration_digest = SHA-256(domain || network_id || contract_id || payable_id_hash || proof_hash || recipient || asset_contract_id || amount || policy_hash || expiry)`. Este es el mensaje firmado con Ed25519. El contrato lo **recalcula** desde sus argumentos tipados y su configuración, y verifica el issuer autorizado.

Codificación propuesta para el paso 2, sin JSON ni delimitadores ambiguos:

| Campo | Bytes |
|---|---|
| `domain` | ASCII `PAKTA_REG_V1` seguido de `00` (13 bytes) |
| `network_id` | SHA-256 de la passphrase UTF-8 de Stellar (32) |
| `contract_id` | identificador binario de contrato, decodificado de StrKey `C...` (32) |
| `payable_id_hash` | SHA-256 del `payable_id` UTF-8 (32) |
| `proof_hash` | 32 bytes del hex canónico |
| `recipient` | account ID binario de `vendor_wallet` `G...` (32) |
| `asset_contract_id` | ID binario del SAC configurado (32) |
| `amount` | i128 positivo, big endian, unidades de 10^-7 USDC (16) |
| `policy_hash` | SHA-256 del `policy_version` UTF-8 (32) |
| `expiry` | segundos Unix sin fracción, u64 big endian (8) |

El builder y el adapter obtienen `asset_contract_id` de un manifiesto de despliegue versionado. El contrato usa su `Config.asset`. La firma queda ligada a red, contrato, payable, destinatario, asset, monto, policy y vencimiento. Un proof válido en otro contrato o red no se puede reutilizar. El contrato no puede demostrar que los documentos off-chain son verdaderos: **confía en el issuer**. Si el issuer está comprometido, el vault y sus caps siguen siendo la última barrera cuantitativa, no una garantía de validez empresarial.

### Vectores y pruebas obligatorias antes de `register_payable`

- Un payload fijo + JSON JCS exacto + hash esperado en TS. Cambiar orden de claves sin cambiar valores conserva el hash; cambiar un valor lo altera. Prohibir enteros no seguros, floats y campos desconocidos.
- Un digest fijo con bytes intermedios y hash esperado en TS y Rust. Mutar `recipient`, `amount`, `asset_contract_id`, `expiry`, `contract_id` o `network_id` debe invalidar la firma.
- Una firma válida de issuer permitido pasa; firma falsa, issuer no permitido y dos firmas repetidas no pasan.
- El ID no se puede registrar dos veces mientras el marcador de replay esté retenido. Añadir una prueba de TTL/archival que haga explícito el límite de retención.
- Solo el executor configurado puede llamar `settle(payable_id)`; el issuer puede revocar el payable antes de settlement; un payable revocado no se liquida. La revocación debe ser idempotente y no puede revertir un SETTLED.
- El cap por ventana se aplica en el mismo cambio atómico que `settle`; actualizar límites no reinicia el gasto ya contabilizado en la ventana activa. Treasury debe poder retirar saldo no comprometido mediante un método autorizado y probado.

## 3. Entrega de direcciones a Dev 2

Archivo de solo direcciones públicas: `fixtures/stellar-testnet-addresses.json`. Correspondencia `VEN-001`…`VEN-005` con sus wallets; `invoice_004_changed_wallet` se usa **solo** como dirección distinta en la factura de `INV-004`. Las seis identidades se fondearon mediante `stellar keys fund --network testnet`; `stellar token balance --id native --account <G...> --network testnet --decimal` confirmó **10 000 XLM en cada una**. Las seeds están únicamente en `.stellar/identity/` local, ignorado por Git; no se copian al fixture ni a docs. Son claves de demo, nunca para dinero real.

Dev 2 debe reemplazar las direcciones de `demo-data.json`, reconstruir el workbook y mantener el resultado 1 READY + 4 BLOCKED, especialmente `VENDOR_WALLET_CHANGED` para `INV-004`. Esa edición es de su dominio. Dev 1 valida después que el adapter acepta el proof real sin cambiar su forma. Las cuentas están fondeadas en XLM; las trustlines USDC siguen pendientes hasta que exista el asset de demo.

## 4. Scaffold y comprobaciones de Día 0

- `contracts/` es Cargo workspace; `contracts/payable-contract/` contiene un contrato invocable mínimo con `contract_version()`. No existe aún ninguna función que mueva fondos.
- `packages/proof-hash/` y `packages/stellar-sdk-wrapper/` están creados como workspaces TypeScript. Sus APIs se implementan después de acordar v1.1.
- `.gitignore` cubre `contracts/target/` y `.stellar/`; `git check-ignore` debe confirmar ambos.
- `node --test scripts/verify-demo-addresses.test.mjs` verifica cinco IDs distintos, checksum StrKey y destino alternativo de `INV-004`.
- `cd contracts && cargo test --workspace` verifica el scaffold; `cargo build --target wasm32v1-none --release` verifica el target WASM cuando esté instalado.
- `pnpm test` y `pnpm typecheck` deben continuar pasando para Dev 2. No marcar tests como verdes hasta ejecutarlos en este entorno.

**Resultados ejecutados el 23-sep:** `cargo test --workspace` 1/1; `cargo build --target wasm32v1-none --release` genera `payable_contract.wasm`; `cargo fmt --all -- --check` limpio; test de direcciones 2/2; suite Vitest 45/45; typecheck de los cinco paquetes limpio; `git diff --check` limpio. La suite se ejecutó con la instalación de pnpm 10.30.1 disponible localmente y `--lockfile=false`, porque el lanzador de pnpm 12.6.0 de esta máquina falla y pnpm 12 aplica una política `minimumReleaseAge` que hoy rechaza 17 dependencias transitivas ya fijadas. No se desactivó esa política. El lockfile original contenía dos documentos YAML concatenados; se conservó el documento de dependencias del proyecto y se añadieron importers vacíos para los dos nuevos paquetes. Validación YAML: cinco importers presentes.

## 5. Decisiones que faltan del equipo

1. Aprobar o rechazar vault con custodia limitada; definir cap agregado, administración y retiro. Cambiar las afirmaciones de «sin custodia» si se aprueba.
2. Acordar `SignedProofV11`, codificaciones de hashes de evidencia y quién posee la key del issuer. Luego editar `canonical-model` juntos en un cambio atómico con tests.
3. Confirmar catálogo de eventos y si se registra lifecycle off-chain, on-chain o ambos.
4. Definir fecha real de demo y cuánto tiempo se mantiene el marcador anti-replay respecto al vault.
5. Definir quién opera el executor y cómo el kernel notifica la revocación al contrato antes de permitir nuevos pagos. Una revalidación local sin este paso no es una barrera on-chain.

Ninguna de estas decisiones se considera cerrada por haber escrito este documento. El contrato de pago se implementa solo después de cerrarlas.
