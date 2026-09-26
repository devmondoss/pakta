import Image from "next/image";
import { PolicyInfo } from "@/components/PolicyInfo";

export function Header() {
  return (
    <header className="border-b-[1.5px] border-border bg-background">
      <div className="mx-auto flex max-w-[1180px] items-center justify-between px-5 py-4 sm:px-8">
        <div className="flex items-center gap-2">
          <Image src="/pakta-logo.png" alt="Pakta" width={22} height={22} priority />
          <span className="font-mono text-sm font-medium tracking-tight">Pakta</span>
        </div>
        <PolicyInfo />
      </div>
    </header>
  );
}
