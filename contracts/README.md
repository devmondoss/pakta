# Payable contract workspace

Scaffold generado con Stellar CLI 27.1.0. El crate usa `soroban-sdk` 27 y vive en
`payable-contract/` dentro de este Cargo workspace.

```powershell
cd contracts
cargo test --workspace
cargo build --target wasm32v1-none --release
```

Este scaffold solo comprueba que la cadena de compilación funciona. El modelo
MVP acordado para Dev 1 es un vault prefondeado con caps por payable y ventana;
`settle(payable_id)` transferirá desde el balance del contrato después de
verificar el proof firmado y la autorización del executor. El schema compartido
v1.1 se cerrará con Dev 2 (ver `docs/implementation/Pakta_Division_Trabajo.md`
§7). Ninguna función actual mueve fondos, y aún no hay deploy en testnet.
