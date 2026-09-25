import { PageHeader } from "@/components/PageHeader";

const RULES = [
  { label: "Requiere PO vinculada", value: "Sí" },
  { label: "Requiere recepción confirmada", value: "Sí" },
  { label: "Tolerancia de monto", value: "2%" },
  { label: "Detección de duplicados", value: "Sí" },
  { label: "Cambio de wallet requiere revisión humana", value: "Sí" },
  { label: "Auto-pago por debajo de", value: "1,000 USDC" },
  { label: "Doble aprobación por encima de", value: "5,000 USDC" },
];

export default function PolicyPage() {
  return (
    <div>
      <PageHeader title="Policy" description="Configuración del motor de reglas · FIN-4.2" />

      <div className="overflow-hidden rounded-3xl bg-surface shadow-[var(--shadow)]">
        {RULES.map((rule, i) => (
          <div
            key={rule.label}
            className={`flex items-center justify-between px-5 py-3.5 ${
              i !== RULES.length - 1 ? "border-b border-border/60" : ""
            }`}
          >
            <span className="text-sm">{rule.label}</span>
            <span className="text-sm font-medium text-accent">{rule.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
