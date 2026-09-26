import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pakta — Evidence before execution",
  description: "Verifiable payables control for agentic settlement.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es" className="h-full antialiased">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
