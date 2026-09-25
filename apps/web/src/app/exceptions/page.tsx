import { PageHeader } from "@/components/PageHeader";
import { RevalidateButton } from "@/components/RevalidateButton";
import { SeverityBadge } from "@/components/StatusBadge";
import { getPayables } from "@/lib/api";

export default async function ExceptionsPage() {
  const payables = await getPayables();
  const exceptions = payables.filter((p) => p.exception);

  return (
    <div>
      <PageHeader
        title="Exceptions"
        description={`${exceptions.length} payables bloqueados, esperando resolución por su owner.`}
      />

      <div className="flex flex-col gap-3">
        {exceptions.map((p) => (
          <div key={p.payableId} className="rounded-2xl bg-surface p-4 shadow-[var(--shadow)]">
            <div className="mb-2 flex items-start justify-between">
              <div>
                <span className="font-mono text-xs text-muted">{p.invoiceId}</span>
                <span className="mx-2 text-border">·</span>
                <span className="text-sm font-medium">{p.vendorName}</span>
              </div>
              <SeverityBadge severity={p.exception!.severity} />
            </div>

            <p className="mb-3 text-sm text-foreground/90">{p.exception!.message}</p>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-xs text-muted">
                <span>
                  Reason: <code className="text-foreground">{p.exception!.reason}</code>
                </span>
                <span>
                  Owner: <span className="text-foreground">{p.exception!.ownerRole}</span>
                </span>
                <span>
                  Required action:{" "}
                  <span className="text-foreground">{p.exception!.requiredAction}</span>
                </span>
              </div>
              <RevalidateButton payableId={p.payableId} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
