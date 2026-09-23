# Payable contract workspace

Scaffold generado con Stellar CLI 27.1.0. El crate usa `soroban-sdk` 27 y vive en
`payable-contract/` dentro de este Cargo workspace.

```powershell
cd contracts
cargo test --workspace
cargo build --target wasm32v1-none --release
```

Este scaffold solo comprueba que la cadena de compilación funciona. Las funciones
que registran y liquidan pagos se implementarán después de acordar la propuesta
de `ProofOfPayable` v1.1 con Dev 2. Ninguna función actual mueve fondos.
