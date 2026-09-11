import Link from "next/link";
import { requireTalent } from "@/lib/talent/access";
import { listCompanies, listOrgClients } from "@/lib/talent/queries";
import { CompanyForm } from "@/components/talent/CompanyForm";
import { Chip, Empty, PageHeader, Panel } from "@/components/talent/bits";
import { Button } from "@/components/ui/button";
import { ago, place } from "@/lib/talent/format";
import { COMPANY_KIND, label } from "@/lib/talent/types";
import { CompanyLogo } from "@/components/ui/thumbnail";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";

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
          <Table>
            <THead>
              <TR>
                <TH>Company</TH>
                <TH>Industry</TH>
                <TH>Location</TH>
                <TH numeric>People</TH>
                <TH numeric>Jobs</TH>
                <TH>Last activity</TH>
              </TR>
            </THead>
            <TBody>
              {companies.map((c) => (
                <TR key={c.id} >
                  <TD>
                    <Link
                      href={`/talent/companies/${c.id}`}
                      className="flex items-center gap-2 font-medium hover:underline"
                    >
                      <CompanyLogo name={c.name} domain={c.domain} src={c.logo_url} size={20} />
                      {c.name}
                    </Link>
                    <div className="mt-0.5 flex items-center gap-1.5">
                      <Chip colour={c.kind === "client" ? "emerald" : c.kind === "target" ? "violet" : "slate"}>
                        {label(COMPANY_KIND, c.kind)}
                      </Chip>
                      {c.domain && <span className="text-xs text-muted-foreground">{c.domain}</span>}
                    </div>
                  </TD>
                  <TD className="text-muted-foreground">{c.industry ?? "—"}</TD>
                  <TD className="text-muted-foreground">{place(c.city, c.state)}</TD>
                  <TD numeric className="text-muted-foreground">
                    {c.tal_people?.[0]?.count ?? 0}
                  </TD>
                  <TD numeric className="text-muted-foreground">
                    {c.tal_jobs?.[0]?.count ?? 0}
                  </TD>
                  <TD className="text-muted-foreground">{ago(c.last_activity_at)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Panel>
    </div>
  );
}
