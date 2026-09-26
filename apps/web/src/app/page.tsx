import { IntakeFlow } from "@/components/IntakeFlow";
import { PayablesBoard } from "@/components/PayablesBoard";
import { getPayables, getVendors } from "@/lib/api";

export default async function DashboardPage() {
  const [payables, vendors] = await Promise.all([getPayables(), getVendors()]);

  return (
    <div className="flex flex-col gap-10">
      <IntakeFlow />

      <div id="resultados">
        <PayablesBoard initialPayables={payables} vendors={vendors} />
      </div>
    </div>
  );
}
