const STATUS_STYLES = {
  READY: { pill: "bg-ready-bg text-ready", dot: "bg-ready" },
  BLOCKED: { pill: "bg-blocked-bg text-blocked", dot: "bg-blocked" },
  // Paid on Stellar — distinct from READY so nobody reads it as still pending.
  SETTLED: { pill: "bg-sky-500/10 text-sky-700 dark:text-sky-400", dot: "bg-sky-500" },
} as const;

export function StatusBadge({ status }: { status: keyof typeof STATUS_STYLES }) {
  const style = STATUS_STYLES[status];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${style.pill}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
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
