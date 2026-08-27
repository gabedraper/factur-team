import Link from "next/link";
import { requireTalent } from "@/lib/talent/access";
import { getSettings, listApplications } from "@/lib/talent/queries";
import { ApplicationReview } from "@/components/talent/ApplicationReview";
import { PageHeader } from "@/components/talent/bits";

export const dynamic = "force-dynamic";

export default async function ApplicationsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const access = await requireTalent("recruit");
  const params = await searchParams;
  const [applications, settings] = await Promise.all([
    listApplications({ status: params.status }),
    getSettings(),
  ]);

  return (
    <div className="max-w-3xl space-y-4 p-6">
      <PageHeader title="Applications" count={applications.length} />

      {!settings.careers_page_enabled && access.admin && (
        <p className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
          Careers page is off ·{" "}
          <Link href="/settings/talent?tab=careers" className="text-primary hover:underline">
            Settings
          </Link>
        </p>
      )}

      <div className="flex flex-wrap gap-1">
        {[
          { key: "new", label: "New" },
          { key: "accepted", label: "Accepted" },
          { key: "rejected", label: "Rejected" },
          { key: "all", label: "All" },
        ].map((f) => (
          <Link
            key={f.key}
            href={`/talent/applications?status=${f.key}`}
            className={`rounded-full px-3 py-1 text-xs ${
              (params.status ?? "new") === f.key
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:text-foreground"
            }`}
          >
            {f.label}
          </Link>
        ))}
      </div>

      <ApplicationReview applications={applications as never[]} />
    </div>
  );
}
