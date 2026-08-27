import Link from "next/link";
import { requireTalent } from "@/lib/talent/access";
import { listCompanies, listOrgClients } from "@/lib/talent/queries";
import { CompanyForm } from "@/components/talent/CompanyForm";
import { Chip, Empty, PageHeader, Panel } from "@/components/talent/bits";
import { Button } from "@/components/ui/button";
import { ago, place } from "@/lib/talent/format";
import { COMPANY_KIND, label } from "@/lib/talent/types";

export const dynamic = "force-dynamic";

export default async function CompaniesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; kind?: string }>;
}) {
  const access = await requireTalent("view");
  const params = await searchParams;
  const [{ companies, total }, clients] = await Promise.all([
    listCompanies({ q: params.q, kind: params.kind }),
    access.recruit ? listOrgClients() : Promise.resolve([]),
  ]);

  return (
    <div className="space-y-4 p-6">
      <PageHeader title="Companies" count={total}>
        {access.recruit && <CompanyForm clients={clients} />}
      </PageHeader>

      <form className="flex flex-wrap items-center gap-2" action="/talent/companies">
        <input
          name="q"
          defaultValue={params.q ?? ""}
          placeholder="Name or domain"
          className="w-64 rounded-md border bg-background px-3 py-1.5 text-sm"
        />
        <select
          name="kind"
          defaultValue={params.kind ?? ""}
          className="rounded-md border bg-background px-2 py-1.5 text-sm"
        >
          <option value="">Any type</option>
          {Object.entries(COMPANY_KIND).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <Button size="sm" variant="outline" type="submit">Search</Button>
      </form>

      <Panel>
        {companies.length === 0 ? <Empty>No companies</Empty> : (
          <table className="w-full text-sm">
            <thead className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Company</th>
                <th className="px-4 py-2 font-medium">Industry</th>
                <th className="px-4 py-2 font-medium">Location</th>
                <th className="px-4 py-2 text-right font-medium">People</th>
                <th className="px-4 py-2 text-right font-medium">Jobs</th>
                <th className="px-4 py-2 font-medium">Last activity</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {companies.map((c) => (
                <tr key={c.id} className="hover:bg-accent/40">
                  <td className="px-4 py-2.5">
                    <Link href={`/talent/companies/${c.id}`} className="font-medium hover:underline">
                      {c.name}
                    </Link>
                    <div className="mt-0.5 flex items-center gap-1.5">
                      <Chip colour={c.kind === "client" ? "emerald" : c.kind === "target" ? "violet" : "slate"}>
                        {label(COMPANY_KIND, c.kind)}
                      </Chip>
                      {c.domain && <span className="text-xs text-muted-foreground">{c.domain}</span>}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground">{c.industry ?? "—"}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{place(c.city, c.state)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                    {c.tal_people?.[0]?.count ?? 0}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                    {c.tal_jobs?.[0]?.count ?? 0}
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground">{ago(c.last_activity_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}
