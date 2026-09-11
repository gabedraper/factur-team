import { notFound } from "next/navigation";
import { taskDetail } from "@/actions/work-detail";
import { TaskDetailView } from "@/components/work/TaskDetailView";
import { myPermissions } from "@/lib/org";
import { NoAccess } from "@/components/no-access";

export const dynamic = "force-dynamic";

/*
 * /work/task/<id> mirrors ClickUp's /t/<id>, so a link copied from one can be
 * rewritten to the other by hand.
 */
export default async function TaskPage({
  params,
}: {
  params: Promise<{ clickupId: string }>;
}) {
  const perms = await myPermissions();
  if (!perms.has("work.view") && !perms.has("org.manage")) {
    return <NoAccess section="ClickUp" need="View ClickUp work" />;
  }

  const { clickupId } = await params;
  const task = await taskDetail(clickupId);
  if (!task) notFound();

  return <TaskDetailView t={task} />;
}
