import { ControlRoomFlow } from "@/components/ControlRoomFlow";
import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";
import { getPayables, getVendors } from "@/lib/api";

export default async function ControlRoomPage() {
  const [payables, vendors] = await Promise.all([getPayables(), getVendors()]);

  return (
    <div className="control-shell flex min-h-screen flex-col">
      <Header />
      <main className="control-main flex-1">
        <ControlRoomFlow initialPayables={payables} vendors={vendors} />
      </main>
      <Footer />
    </div>
  );
}
