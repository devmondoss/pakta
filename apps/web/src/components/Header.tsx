"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { href: "/", label: "Intake" },
  { href: "/payables", label: "Payables" },
  { href: "/exceptions", label: "Exceptions" },
  { href: "/proof-of-payable", label: "Proof" },
  { href: "/vendors", label: "Vendors" },
  { href: "/policy", label: "Policy" },
];

export function Header() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-10 border-b border-border/60 bg-surface/90 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-8 py-3.5">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-accent" />
          <span className="text-sm font-semibold tracking-tight">Pakta</span>
        </div>

        <nav className="flex items-center gap-0.5 rounded-full bg-background p-1">
          {NAV_ITEMS.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                  active
                    ? "bg-surface text-accent shadow-[var(--shadow)]"
                    : "text-muted hover:text-foreground"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div
          title="Dev 2 — Agentic / AI Workflows"
          className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-foreground"
        >
          D2
        </div>
      </div>
    </header>
  );
}
