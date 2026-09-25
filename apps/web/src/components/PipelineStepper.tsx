import Link from "next/link";

type Step = {
  label: string;
  detail: string;
  href: string;
  state: "done" | "active" | "next";
};

export function PipelineStepper({ steps }: { steps: Step[] }) {
  return (
    <div className="flex items-stretch gap-0">
      {steps.map((step, i) => (
        <div key={step.label} className="flex flex-1 items-center">
          <Link href={step.href} className="group flex flex-1 flex-col gap-2">
            <div className="flex items-center gap-2">
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
                  step.state === "done"
                    ? "bg-ready text-white"
                    : step.state === "active"
                      ? "bg-accent text-accent-foreground"
                      : "bg-background text-muted"
                }`}
              >
                {step.state === "done" ? "✓" : i + 1}
              </span>
              <span
                className={`text-sm font-medium transition-colors ${
                  step.state === "next" ? "text-muted" : "text-foreground"
                } group-hover:text-accent`}
              >
                {step.label}
              </span>
            </div>
            <span className="pl-8 text-xs text-muted">{step.detail}</span>
          </Link>
          {i < steps.length - 1 && (
            <div className="mx-3 h-px flex-1 self-start bg-border mt-3" />
          )}
        </div>
      ))}
    </div>
  );
}
