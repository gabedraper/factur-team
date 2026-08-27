import Link from "next/link";
import { Radar } from "lucide-react";
import { requireTalent } from "@/lib/talent/access";
import { integrationStatus, listPeople, searchResumes } from "@/lib/talent/queries";
import { AddPerson } from "@/components/talent/AddPerson";
import { Avatar, Empty, NotConnected, PageHeader, Panel } from "@/components/talent/bits";
import { Button } from "@/components/ui/button";
import { ago, place } from "@/lib/talent/format";

export const dynamic = "force-dynamic";

/**
 * Sourcing, in the two halves it actually has.
 *
 * The half that works searches the database Factur already owns -- names,
 * titles, employers and the text of every resume on file. The half that does
 * not is the market-wide index, and there is no honest way to build it: Loxo
 * Source is a licensed people graph, not a feature, and the panel below says so
 * rather than showing an empty result set that looks like a bad search.
 */
export default async function SourcingPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; skill?: string; where?: string }>;
}) {
  const access = await requireTalent("view");
  const params = await searchParams;
  const term = params.q?.trim() ?? "";

  const [{ people }, resumeHits, search, enrich, extension] = await Promise.all([
    term || params.skill
      ? listPeople({ q: term, skill: params.skill, limit: 25 })
      : Promise.resolve({ people: [], total: 0 }),
    term ? searchResumes(term, 25) : Promise.resolve([]),
    integrationStatus("people_search"),
    integrationStatus("contact_enrichment"),
    integrationStatus("linkedin_extension"),
  ]);

  const inDatabase = new Set(people.map((p) => p.id));
  const extra = resumeHits.filter((r) => !inDatabase.has(r.id));

  return (
    <div className="max-w-5xl space-y-4 p-6">
      <PageHeader title="Sourcing">
        {access.recruit && <AddPerson />}
      </PageHeader>

      <form className="flex flex-wrap items-center gap-2" action="/talent/sourcing">
        <input
          name="q"
          defaultValue={term}
          placeholder="Title, skill, employer or resume text"
          className="w-80 rounded-md border bg-background px-3 py-1.5 text-sm"
        />
        <input
          name="skill"
          defaultValue={params.skill ?? ""}
          placeholder="Skill tag"
          className="w-40 rounded-md border bg-background px-3 py-1.5 text-sm"
        />
        <Button size="sm" type="submit">Search</Button>
      </form>

      <Panel
        title={
          <span className="flex items-center gap-2">
            <Radar className="h-4 w-4" />
            In our database
          </span>
        }
      >
        {!term && !params.skill ? (
          <Empty>Search to begin</Empty>
        ) : people.length + extra.length === 0 ? (
          <Empty>Nobody matched</Empty>
        ) : (
          <ul className="divide-y">
            {[...people.map((p) => ({
              id: p.id, name: p.name, title: p.title, company: p.company,
              city: p.city, state: p.state, last: p.last_activity_at, via: "profile",
            })), ...extra.map((r) => ({
              id: r.id, name: r.name, title: r.title, company: r.company_name,
              city: r.city, state: r.state, last: r.last_activity_at, via: "resume",
            }))].map((p) => (
              <li key={p.id} className="flex items-center gap-3 px-4 py-2.5">
                <Avatar name={p.name} />
                <div className="min-w-0 flex-1">
                  <Link href={`/talent/people/${p.id}`} className="font-medium hover:underline">
                    {p.name}
                  </Link>
                  <p className="truncate text-xs text-muted-foreground">
                    {[p.title, p.company, place(p.city, p.state)].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {p.via === "resume" ? "resume match" : ""}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">{ago(p.last)}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <div className="grid gap-3 lg:grid-cols-3">
        <NotConnected name={search.name} requires={search.requires} canAdmin={access.admin} />
        <NotConnected name={enrich.name} requires={enrich.requires} canAdmin={access.admin} />
        <NotConnected name={extension.name} requires={extension.requires} canAdmin={access.admin} />
      </div>
    </div>
  );
}
