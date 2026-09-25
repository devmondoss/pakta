import { PageHeader } from "@/components/PageHeader";
import { getPayables, getProof } from "@/lib/api";

export default async function ProofOfPayablePage() {
  const payables = await getPayables();
  const ready = payables.find((p) => p.status === "READY");
  const apiProof = ready ? await getProof(ready.payableId) : null;

  const proof = ready && apiProof && {
    vendorName: ready.vendorName,
    amount: apiProof.amount,
    wallet: apiProof.vendor_wallet,
    expiresAt: new Date(apiProof.expires_at).toLocaleDateString("es", {
      day: "numeric",
      month: "short",
      year: "numeric",
    }),
    invoiceHash: apiProof.invoice_hash,
    poHash: apiProof.po_hash,
  };

  return (
    <div>
      <PageHeader
        title="Proof-of-Payable"
        description="El hand-off hacia Dev 1 / Settlement."
      />

      {proof ? (
        <div className="rounded-3xl bg-surface p-6 shadow-[var(--shadow)]">
          <div className="mb-5 flex items-center justify-between">
            <p className="text-sm font-medium">{proof.vendorName}</p>
            <span className="rounded-full bg-ready-bg px-2.5 py-1 text-xs font-medium text-ready">
              Listo para pagar
            </span>
          </div>

          <p className="font-mono text-3xl font-medium">{proof.amount} <span className="text-base text-muted">USDC</span></p>
          <p className="mt-1 text-xs text-muted">Vence {proof.expiresAt} · wallet atestiguada</p>

          <details className="mt-5 text-xs text-muted">
            <summary className="cursor-pointer select-none hover:text-foreground">
              Detalles técnicos
            </summary>
            <div className="mt-3 flex flex-col gap-1.5 font-mono">
              <span>invoice_hash: {proof.invoiceHash}</span>
              <span>po_hash: {proof.poHash}</span>
            </div>
          </details>
        </div>
      ) : (
        <p className="text-sm text-muted">Ningún payable llegó a READY todavía.</p>
      )}
    </div>
  );
}
