import { PageHeader } from "@/components/PageHeader";
import { IntakeFlow } from "@/components/IntakeFlow";
import { getSummary } from "@/lib/api";

export default async function IntakePage() {
  const summary = await getSummary();

  return (
    <div>
      <PageHeader
        title="Cargá tu evidencia"
        description="Excel, PDF o email — Pakta lo normaliza todo al mismo modelo antes de tocar las reglas de negocio."
      />
      <IntakeFlow summary={summary} />
    </div>
  );
}
