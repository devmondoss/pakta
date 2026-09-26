import { PolicyInfo } from "@/components/PolicyInfo";

export function Header() {
  return (
    <header className="border-b-[1.5px] border-border bg-background">
      <div className="mx-auto flex max-w-[1180px] items-center justify-between px-5 py-4 sm:px-8">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-accent" />
          <span className="font-mono text-sm font-medium tracking-tight">Pakta</span>
        </div>
        <PolicyInfo />
      </div>
    </header>
  );
}
