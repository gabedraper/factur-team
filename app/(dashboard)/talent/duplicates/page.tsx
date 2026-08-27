import { requireTalent } from "@/lib/talent/access";
import { duplicatePeople } from "@/lib/talent/queries";
import { DuplicateList } from "@/components/talent/DuplicateList";
import { PageHeader } from "@/components/talent/bits";

export const dynamic = "force-dynamic";

export default async function DuplicatesPage() {
  const access = await requireTalent("view");
  const pairs = await duplicatePeople();

  return (
    <div className="max-w-4xl space-y-4 p-6">
      <PageHeader title="Duplicates" count={pairs.length} />
      <DuplicateList pairs={pairs} canEdit={access.recruit} />
    </div>
  );
}
