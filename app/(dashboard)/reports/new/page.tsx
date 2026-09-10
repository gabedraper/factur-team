import { ReportBuilder } from "@/components/reporting/ReportBuilder";
import { listObjects } from "@/lib/reporting/data";

export const dynamic = "force-dynamic";

export default async function NewReportPage() {
  const objects = await listObjects();
  return <ReportBuilder objects={objects} initial={null} canDelete={false} />;
}
