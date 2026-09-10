import { notFound, redirect } from "next/navigation";
import { DashboardEditor } from "@/components/reporting/DashboardEditor";
import { currentMemberId, myPermissions } from "@/lib/org";
import { canEdit, getDashboard, listReports } from "@/lib/reporting/data";

export const dynamic = "force-dynamic";

export default async function EditDashboardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [dashboard, reports, memberId, perms] = await Promise.all([
    getDashboard(id), listReports(), currentMemberId(), myPermissions(),
  ]);
  if (!dashboard) notFound();
  // A shared dashboard that is not yours is read-only; the view page says so.
  if (!canEdit(dashboard, memberId, perms as Set<string>)) redirect(`/reports/dashboards/${id}`);
  return <DashboardEditor reports={reports} initial={dashboard} canDelete />;
}
