export function StatusBadge({ status }: { status: "READY" | "BLOCKED" | "SETTLED" }) {
  const styles: Record<string, string> = {
    READY: "bg-ready-bg text-ready",
    BLOCKED: "bg-blocked-bg text-blocked",
    SETTLED: "bg-settled-bg text-settled",
  };
  const dotStyles: Record<string, string> = {
    READY: "bg-ready",
    BLOCKED: "bg-blocked",
    SETTLED: "bg-settled",
  };
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${styles[status]}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${dotStyles[status]}`} />
      {status}
    </span>
  );
}

export function SeverityBadge({ severity }: { severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" }) {
  const styles: Record<string, string> = {
    LOW: "bg-border/50 text-muted",
    MEDIUM: "bg-live-bg text-live",
    HIGH: "bg-[#ff9f5a]/15 text-[#ff9f5a]",
    CRITICAL: "bg-blocked-bg text-blocked",
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${styles[severity]}`}>
      {severity}
    </span>
  );
}
