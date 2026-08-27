import { requireTalent } from "@/lib/talent/access";
import { currentMemberId } from "@/lib/org";
import { listMembers, listTasks } from "@/lib/talent/queries";
import { TaskList } from "@/components/talent/TaskList";
import { PageHeader } from "@/components/talent/bits";

export const dynamic = "force-dynamic";

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{ owner?: string; done?: string }>;
}) {
  const access = await requireTalent("view");
  const params = await searchParams;
  const me = await currentMemberId();

  const owner = params.owner === "all" ? undefined : params.owner ?? me ?? undefined;
  const [tasks, members] = await Promise.all([
    listTasks({ memberId: owner, openOnly: params.done !== "1" }),
    listMembers(),
  ]);

  return (
    <div className="max-w-4xl space-y-4 p-6">
      <PageHeader title="Tasks" count={tasks.length} />
      <TaskList
        tasks={tasks as never[]}
        members={members}
        canEdit={access.recruit}
        owner={params.owner ?? me ?? "all"}
        showingDone={params.done === "1"}
      />
    </div>
  );
}
