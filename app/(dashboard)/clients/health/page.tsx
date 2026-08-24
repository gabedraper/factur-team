import { getClientHealth } from "@/lib/clients/health";
import { HealthTable } from "@/components/clients/HealthTable";

export const dynamic = "force-dynamic";

export default async function ClientHealthPage() {
  const clients = await getClientHealth();

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-xl font-semibold">Client Health</h1>
      <HealthTable clients={clients} />
    </div>
  );
}
