import { DashboardEditor } from "@/components/reporting/DashboardEditor";
import { listReports } from "@/lib/reporting/data";

export const dynamic = "force-dynamic";

export default async function NewDashboardPage() {
  const reports = await listReports();
  return <DashboardEditor reports={reports} initial={null} canDelete={false} />;
}
