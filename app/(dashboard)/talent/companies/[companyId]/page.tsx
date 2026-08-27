import Link from "next/link";
import { notFound } from "next/navigation";
import { requireTalent } from "@/lib/talent/access";
import {
  getCompany, listActivityTypes, listMembers, listNoteTemplates, listOrgClients,
} from "@/lib/talent/queries";
import { CompanyForm } from "@/components/talent/CompanyForm";
import { ActivityFeed } from "@/components/talent/ActivityFeed";
import { LogActivity } from "@/components/talent/LogActivity";
import { Avatar, Chip, Empty, PageHeader, Panel, Stat } from "@/components/talent/bits";
import { ago, money, place } from "@/lib/talent/format";
import { COMPANY_KIND, DEAL_STAGE, JOB_STATUS, label } from "@/lib/talent/types";

export const dynamic = "force-dynamic";

export default async function CompanyPage({ params }: { params: Promise<{ companyId: string }> }) {
  const access = await requireTalent("view");
  const { companyId } = await params;

  const data = await getCompany(companyId);
  if (!data) notFound();
  const { company, people, jobs, activities, deals } = data;

  const [members, types, templates, clients] = await Promise.all([
    listMembers(), listActivityTypes(), listNoteTemplates("company"),
    access.recruit ? listOrgClients() : Promise.resolve([]),
  ]);
  const authors = new Map(members.map((m) => [m.id, m.full_name ?? m.email]));

  return (
    <div className="space-y-4 p-6">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0">
          <PageHeader title={company.name}>
            <Chip colour={company.kind === "client" ? "emerald" : company.kind === "target" ? "violet" : "slate"}>
              {label(COMPANY_KIND, company.kind)}
            </Chip>
          </PageHeader>
          <p className="mt-1 text-sm text-muted-foreground">
            {[company.industry, place(company.city, company.state), company.headcount_label]
              .filter(Boolean).join(" · ") || "—"}
          </p>
          {company.domain && (
            <a
              href={`https://${company.domain}`}
              target="_blank"
              rel="noreferrer"
              className="text-sm text-primary hover:underline"
            >
              {company.domain}
            </a>
          )}
        </div>
        <div className="ml-auto">
          {access.recruit && (
            <CompanyForm company={company} clients={clients} trigger="Edit" />
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 rounded-lg border bg-card px-4 py-3 sm:grid-cols-4">
        <Stat label="People" value={people.length} />
        <Stat label="Jobs" value={jobs.length} />
        <Stat label="Open deals" value={deals.length} />
        <Stat label="Last activity" value={ago(company.last_activity_at)} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Jobs">
          {jobs.length === 0 ? <Empty>None</Empty> : (
            <ul className="divide-y text-sm">
              {jobs.map((j) => (
                <li key={j.id} className="flex items-center gap-2 px-4 py-2">
                  <Link href={`/talent/jobs/${j.id}`} className="min-w-0 flex-1 truncate hover:underline">
                    {j.title}
                  </Link>
                  <Chip>{label(JOB_STATUS, j.status)}</Chip>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {j.active_count}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Deals">
          {deals.length === 0 ? <Empty>None</Empty> : (
            <ul className="divide-y text-sm">
              {deals.map((d) => {
                const row = d as Record<string, unknown> & {
                  id: string; name: string; stage: string; value: number | null;
                };
                return (
                  <li key={row.id} className="flex items-center gap-2 px-4 py-2">
                    <span className="min-w-0 flex-1 truncate">{row.name}</span>
                    <Chip>{label(DEAL_STAGE, row.stage)}</Chip>
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {money(row.value)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        <Panel title="People">
          {people.length === 0 ? <Empty>Nobody</Empty> : (
            <ul className="divide-y text-sm">
              {people.map((p) => (
                <li key={p.id} className="flex items-center gap-2.5 px-4 py-2">
                  <Avatar name={p.name} size={6} />
                  <span className="min-w-0 flex-1">
                    <Link href={`/talent/people/${p.id}`} className="block truncate hover:underline">
                      {p.name}
                    </Link>
                    <span className="block truncate text-xs text-muted-foreground">{p.title ?? "—"}</span>
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">{ago(p.last_activity_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Activity">
          {access.recruit && (
            <LogActivity types={types} templates={templates} companyId={company.id} />
          )}
          <ActivityFeed activities={activities} authors={authors} />
        </Panel>
      </div>
    </div>
  );
}
