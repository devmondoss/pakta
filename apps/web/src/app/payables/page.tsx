import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { getPayables } from "@/lib/api";

export default async function PayablesPage() {
  const payables = await getPayables();

  return (
    <div>
      <PageHeader
        title="Payables"
        description={`${payables.length} payables — vía API real (fixture demo-workbook, evaluado por el rules-kernel).`}
      />

      <div className="overflow-hidden rounded-2xl bg-surface shadow-[var(--shadow)]">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border/60 text-left text-xs text-muted">
              <th className="px-4 py-2.5 font-medium">Invoice</th>
              <th className="px-4 py-2.5 font-medium">Vendor</th>
              <th className="px-4 py-2.5 font-medium">PO</th>
              <th className="px-4 py-2.5 font-medium">Amount</th>
              <th className="px-4 py-2.5 font-medium">Due</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {payables.map((p) => (
              <tr key={p.payableId} className="border-b border-border/60 last:border-0">
                <td className="px-4 py-3 font-mono text-xs">{p.invoiceId}</td>
                <td className="px-4 py-3">{p.vendorName}</td>
                <td className="px-4 py-3 font-mono text-xs text-muted">{p.poId}</td>
                <td className="px-4 py-3 font-mono">{p.amount}</td>
                <td className="px-4 py-3 text-muted">{p.dueDate}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <StatusBadge status={p.status} />
                    {p.settlement && (
                      <a
                        href={p.settlement.explorerUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="font-mono text-xs text-muted underline-offset-2 hover:underline"
                        title={`Ledger ${p.settlement.ledger}`}
                      >
                        tx {p.settlement.txHash.slice(0, 8)}…
                      </a>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
