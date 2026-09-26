import { ControlRoomFlow } from "@/components/ControlRoomFlow";
import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";
import { getActivity, getPayables, getVendors } from "@/lib/api";

export default async function ControlRoomPage() {
  const [payables, vendors, activity] = await Promise.all([getPayables(), getVendors(), getActivity()]);

  return (
    <div className="control-shell flex min-h-screen flex-col">
      <Header />
      <main className="control-main flex-1">
        <ControlRoomFlow initialPayables={payables} vendors={vendors} activity={activity} />
      </main>
      <Footer />
    </div>
  );
}
