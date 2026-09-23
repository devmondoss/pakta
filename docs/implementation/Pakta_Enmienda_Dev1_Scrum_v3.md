# Enmienda propuesta — historias Dev 1 de Scrum v3

**Estado:** propuesta para acordar con Dev 2; no modifica todavía `Pakta_Division_Trabajo.md` ni `packages/canonical-model/src/proof.ts`.

**Base:** `main` v3.0 (`a6fd1e3`) incorporado en `dev1`; diseño de Día 0 en `Pakta_Plan_Web3_Stellar.md` y `Pakta_Dia0_Dev1.md`.

## Decisión de arquitectura que bloquea el Sprint 1

El backlog v3 describe que treasury firma `register_payable`, mantiene `payer`/`nonce` en cada payable y autoriza `transfer(payer, recipient, amount)`. El plan Dev 1 propone un vault prefondeado, un proof firmado por issuer y `settle(payable_id)` ejecutado por un rol autorizado. Son **dos modelos de autorización y custodia distintos**. Antes de implementar `register_payable`, `settle` o el SAC, ambos devs deben escoger uno y actualizar backlog, contrato de datos y narrativa de custodia en un mismo cambio.

### Recomendación MVP: vault con caps

Treasury fondea el contrato y define límites por payable y por ventana. El contrato guarda el SAC, el recipient y el amount autorizados; el asset sale del **balance del contrato**. El issuer firma un digest que vincula el `proof_hash` con red, contrato, payable, recipient, SAC, amount, policy y vencimiento. El caller de `register_payable` puede ser cualquiera porque la autoridad es la firma verificada. `settle(payable_id)` exige autorización del executor configurado y nunca recibe recipient ni amount. Esto es **custodia acotada del float por el contrato**, y los textos que afirman «sin custodia» deben cambiar si el equipo aprueba esta opción.

## Traducción propuesta de las historias

| Historia v3 | Criterio de aceptación propuesto para Dev 1 | Verificación mínima |
|---|---|---|
| **HU-D1-02 — storage** | `Config` conserva treasury/admin, executor, issuers, SAC, caps y ventana. `Payable` conserva ID único, `proof_hash`, recipient, amount, policy hash, expiry y estado `READY/REVOKED/SETTLED/EXPIRED`. No hay `payer` ni `nonce` por payable. Storage persistente con TTL renovado. | Escribir/leer ambos structs; probar TTL y que ID usado sigue reservado durante la vida declarada del vault. |
| **HU-D1-03 — registro** | `register_payable` registra directamente un proof `READY`, no una obligación `VERIFYING` sin proof. Verifica issuer permitido, firma Ed25519 sobre digest **recalculado** de argumentos tipados, ID no usado, amount positivo y bajo cap, expiry futuro y asset configurado. Caller permissionless. | Registro válido + rechazos por firma falsa, issuer ajeno, argumento alterado, duplicado, monto y expiry inválidos. |
| **HU-D1-04 — proof** | Sustituir `submit_proof` por especificación y vectores de `proof_hash = SHA-256(JCS(unsigned_proof))` y digest de registro TS↔Rust. No hay transición `VERIFYING → READY` on-chain. | Vectores fijos de JCS y digest; cambiar recipient, amount, SAC, expiry, contract id o network id invalida firma. |
| **HU-D1-05 — excepción** | `attest_lifecycle` emite eventos de auditoría autorizados y no modifica el gate. `revoke_payable` sí cambia `READY → REVOKED` cuando el issuer invalida un proof. | Solo issuer atesta/revoca; revocado no liquida; no puede revocar `SETTLED`; fases enumeradas. |
| **HU-D1-06 — revalidación** | El kernel de Dev 2 revalida fuera de cadena. Si aún no hubo registro, emite el primer proof firmado y se registra. Si un proof registrado fue revocado, **no se reutiliza el mismo ID**: reemisión con un nuevo ID/versionado requiere diseño conjunto; fuera del demo inicial si no se acuerda. | Demo `BLOCKED → READY` registra solo después de la revalidación; prueba de que el ID revocado no se reabre. |
| **HU-D1-07 — settle** | `settle` recibe solo `payable_id`; exige `Config.executor.require_auth()`, `READY`, no expirado, no pausado, saldo suficiente y cap agregado vigente. Lee recipient, amount y SAC del estado/config firmado. Transfer y `SETTLED` son atómicos. | Rechazos de executor ajeno, revocado, expirado, pausado, cap agotado, saldo insuficiente y segundo settle; prueba de recipient/amount/asset exactos y evento de éxito. |
| **HU-D1-08 — expire** | Permissionless después de `expiry`; solo estados no terminales. Conserva marcador anti-replay. | Expira en `now > expiry`; no antes; no altera `SETTLED`. |
| **HU-D1-09 — USDC/SAC** | La transferencia se hace **desde `env.current_contract_address()`**, hacia recipient guardado, por el amount guardado y con el SAC configurado. Treasury fondea el vault antes; un destinatario `G...` necesita trustline autorizada del asset de demo. | Token/SAC de prueba: saldo del vault disminuye exactamente, destinatario aumenta exactamente; tx testnet + cap por pago y ventana. |
| **HU-D1-10 — adapter** | Consume el objeto compartido sin cambiar su significado ni exigirle a Dev 2 un shape ad hoc. Sí convierte de forma determinística strings a bytes/`i128`/timestamp y valida red, contrato y `proof_hash`. La frase «sin transformarlo» no puede ser literal al cruzar TS→Soroban. | Proof real de Dev 2 se acepta sin edición manual; monto con >7 decimales, address inválida o hash distinto se rechazan. |
| **HU-D1-13 — revalidación al ejecutar** | Adapter comprueba estado del kernel justo antes de llamar `settle`; revocaciones llegan al contrato. La auth del executor impide saltarse el adapter con una llamada permissionless. | Proof stale rechazado off-chain; payable revocado rechazado on-chain incluso si alguien invoca directo. |

### Replay y autorización son pruebas separadas

`payable_id` único con marcador persistente protege contra re-registro/doble pago **mientras ese marcador se retenga**. `executor.require_auth()` protege la invocación de `settle`. Uno no sustituye al otro. Si el marcador expira por TTL, el mismo ID podría volver a registrarse; hay que renovar su TTL durante la vida del vault o declarar una vida limitada y cerrar/recrear el vault al terminarla.

### DoD de plataforma

Sustituir «los 4 invariantes» por una lista verificable: firma y binding de argumentos, ID único/TTL, estado READY, expiry, revocación, executor autorizado, recipient/amount/SAC exactos, no doble pago, pause, cap por payable, cap agregado por ventana, transferencia y transición atómica, eventos. Cada condición necesita su test; no basta con contar cuatro o diez tests. Mantener el requisito Scrum v3 de merge a `main` para declarar una historia completa. El scaffold de Día 0 compila, pero **HU-D1-01 aún no está completa** hasta deploy e invoke reales en testnet.

## Cambios de datos y decisiones compartidas

`ProofOfPayable` v1.1, `Settlement`, wallets del fixture y la semántica de reemisión requieren edición conjunta con Dev 2. La propuesta de campos y codificación está en `Pakta_Dia0_Dev1.md` §2; no se ha aplicado a `canonical-model`. También faltan la identidad del issuer, el executor, el treasury, el SAC, la política de retiro del vault y el catálogo final de eventos. El dashboard y el pitch deben llamar al modelo de fondos por su nombre: **vault con custodia limitada**.
