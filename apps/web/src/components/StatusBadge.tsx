export function StatusBadge({ status }: { status: "READY" | "BLOCKED" | "SETTLED" }) {
  const styles: Record<string, string> = {
    READY: "status-ready",
    BLOCKED: "status-blocked",
    SETTLED: "status-settled",
  };
  const dotStyles: Record<string, string> = {
    READY: "bg-ready",
    BLOCKED: "bg-blocked",
    SETTLED: "bg-settled",
  };
  return (
    <span className={`status-badge inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 ${styles[status]}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${dotStyles[status]}`} />
      {status}
    </span>
  );
}

export function SeverityBadge({ severity }: { severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" }) {
  const styles: Record<string, string> = {
    LOW: "severity-low",
    MEDIUM: "severity-medium",
    HIGH: "severity-high",
    CRITICAL: "severity-critical",
  };
  return (
    <span className={`status-badge inline-flex rounded-full px-2 py-0.5 ${styles[severity]}`}>
      {severity}
    </span>
  );
}
