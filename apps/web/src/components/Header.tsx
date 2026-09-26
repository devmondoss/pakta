import { PolicyInfo } from "@/components/PolicyInfo";

export function Header() {
  return (
    <header className="border-b border-border/60">
      <div className="mx-auto flex max-w-3xl items-center justify-between px-5 py-5 sm:px-8">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-accent" />
          <span className="text-sm font-medium tracking-tight">Pakta</span>
        </div>
        <PolicyInfo />
      </div>
    </header>
  );
}
