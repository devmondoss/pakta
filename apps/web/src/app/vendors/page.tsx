import { PageHeader } from "@/components/PageHeader";
import { WalletActions } from "@/components/WalletActions";
import { getVendors } from "@/lib/api";

export default async function VendorsPage() {
  const vendors = await getVendors();

  return (
    <div>
      <PageHeader
        title="Vendors & Wallets"
        description={`${vendors.length} vendors verificados.`}
      />

      <div className="overflow-hidden rounded-2xl bg-surface shadow-[var(--shadow)]">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border/60 text-left text-xs text-muted">
              <th className="px-4 py-2.5 font-medium">Vendor</th>
              <th className="px-4 py-2.5 font-medium">Verification</th>
              <th className="px-4 py-2.5 font-medium">Wallet</th>
              <th className="px-4 py-2.5 font-medium">Attestation</th>
              <th className="px-4 py-2.5 font-medium">Version</th>
              <th className="px-4 py-2.5 font-medium">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {vendors.map((v) => (
              <tr key={v.vendorId} className="border-b border-border/60 last:border-0">
                <td className="px-4 py-3">
                  <div>{v.legalName}</div>
                  <div className="font-mono text-xs text-muted">{v.vendorId}</div>
                </td>
                <td className="px-4 py-3">
                  <span className="rounded-full bg-ready-bg px-2 py-0.5 text-xs font-medium text-ready">
                    {v.verificationStatus}
                  </span>
                </td>
                <td className="px-4 py-3 font-mono text-xs text-muted">{v.wallet?.address ?? "—"}</td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      v.wallet?.attestationStatus === "ATTESTED"
                        ? "bg-ready-bg text-ready"
                        : "bg-blocked-bg text-blocked"
                    }`}
                  >
                    {v.wallet?.attestationStatus ?? "UNATTESTED"}
                  </span>
                </td>
                <td className="px-4 py-3 text-muted">{v.wallet ? `v${v.wallet.version}` : "—"}</td>
                <td className="px-4 py-3">
                  <WalletActions vendorId={v.vendorId} attestationStatus={v.wallet?.attestationStatus} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
