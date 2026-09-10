import { notFound } from "next/navigation";
import { ReportBuilder } from "@/components/reporting/ReportBuilder";
import { currentMemberId, myPermissions } from "@/lib/org";
import { canEdit, getReport, listObjects } from "@/lib/reporting/data";

export const dynamic = "force-dynamic";

/**
 * The builder, loaded with a saved report. Somebody who may not change it
 * (it is shared, and not theirs) gets it as a copy to save under their own
 * name instead of a refusal.
 */
export default async function EditReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [report, objects, memberId, perms] = await Promise.all([
    getReport(id), listObjects(), currentMemberId(), myPermissions(),
  ]);
  if (!report) notFound();
  const editable = canEdit(report, memberId, perms as Set<string>);
  return <ReportBuilder objects={objects} initial={report} canDelete={editable} copy={!editable} />;
}
