# @pakta/web

Dashboard de Pakta para el flujo de intake, payables, excepciones, wallets de
proveedores y proofs. Es una aplicación Next.js 16 que consume `@pakta/api`.

## Ejecutarlo localmente

Desde la raíz del monorepo:

```bash
pnpm --filter @pakta/api dev
pnpm --filter @pakta/web dev
```

Abre [http://localhost:3000](http://localhost:3000). La API escucha en el
puerto 4000 por defecto y necesita `DATABASE_URL`; consulta
[`../../.env.example`](../../.env.example) para las variables locales.

## Variables de entorno

| Variable | Uso | Valor local por defecto |
|---|---|---|
| `API_URL` | API usada por los componentes de servidor | `http://localhost:4000` |
| `NEXT_PUBLIC_API_URL` | API usada por acciones desde el navegador | `http://localhost:4000` |

Las vistas no usan datos mock: leen la API sin caché. Las acciones de receipt,
reverificación de wallet y revalidación actualizan la vista al terminar. Cuando
`/health` anuncia settlement `enabled`, un payable `READY` puede liquidarse
desde su tarjeta. El detalle de un payable `SETTLED` enlaza la transacción en
Stellar Expert y muestra su proof hash y estado ERP.
