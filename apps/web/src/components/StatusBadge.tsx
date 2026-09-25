export function StatusBadge({ status }: { status: "READY" | "BLOCKED" }) {
  const isReady = status === "READY";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${
        isReady ? "bg-ready-bg text-ready" : "bg-blocked-bg text-blocked"
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${isReady ? "bg-ready" : "bg-blocked"}`} />
      {status}
    </span>
  );
}

export function SeverityBadge({ severity }: { severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" }) {
  const styles: Record<string, string> = {
    LOW: "bg-border/50 text-muted",
    MEDIUM: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
    HIGH: "bg-orange-500/10 text-orange-600 dark:text-orange-400",
    CRITICAL: "bg-blocked-bg text-blocked",
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${styles[severity]}`}>
      {severity}
    </span>
  );
}
