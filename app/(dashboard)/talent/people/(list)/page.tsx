import Link from "next/link";
import { Ban, Linkedin, Mail, Phone } from "lucide-react";
import { requireTalent } from "@/lib/talent/access";
import { listMembers, listPeople, searchResumes } from "@/lib/talent/queries";
import { AddPerson } from "@/components/talent/AddPerson";
import { Chip, Empty, PageHeader, Panel } from "@/components/talent/bits";
import { Table, TableScroll, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { ago, place } from "@/lib/talent/format";
import { PERSON_TYPE, label } from "@/lib/talent/types";

export const dynamic = "force-dynamic";

const PAGE = 50;

/**
 * The people database.
 *
 * Two searches, deliberately kept apart. The box searches names, emails and
 * employers and matches on a prefix, which is what somebody half-remembering a
 * surname needs. "In resumes" runs full-text over the parsed CV instead, which
 * is a different question: not who is this, but who has done this.
 */
export default async function PeoplePage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string; resumes?: string; type?: string; owner?: string;
    skill?: string; sort?: string; page?: string;
  }>;
}) {
  const access = await requireTalent("view");
  const params = await searchParams;
  const page = Math.max(1, Number(params.page ?? 1));
  const inResumes = params.resumes === "1" && !!params.q?.trim();

  const [{ people, total }, resumeHits, members] = await Promise.all([
    inResumes
      ? Promise.resolve({ people: [], total: 0 })
      : listPeople({
          q: params.q,
          type: params.type,
          ownerId: params.owner,
          skill: params.skill,
          sort: (params.sort as "recent" | "name" | "readiness" | "added") ?? "recent",
          limit: PAGE,
          offset: (page - 1) * PAGE,
        }),
    inResumes ? searchResumes(params.q!) : Promise.resolve([]),
    listMembers(),
  ]);

  const pages = Math.max(1, Math.ceil(total / PAGE));

  function href(next: Record<string, string | undefined>) {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...params, ...next })) if (v) q.set(k, String(v));
    return `/talent/people${q.size ? `?${q}` : ""}`;
  }

  return (
    <div className="space-y-4 p-6">
      <PageHeader title="People" count={inResumes ? resumeHits.length : total}>
        {access.recruit && <AddPerson />}
      </PageHeader>

      <form className="flex flex-wrap items-center gap-2" action="/talent/people">
        <input
          name="q"
          defaultValue={params.q ?? ""}
          placeholder="Name, email or employer"
          className="w-64 rounded-md border bg-background px-3 py-1.5 text-sm"
        />
        <select
          name="type"
          defaultValue={params.type ?? ""}
          className="rounded-md border bg-background px-2 py-1.5 text-sm"
        >
          <option value="">Any type</option>
          {Object.entries(PERSON_TYPE).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <select
          name="owner"
          defaultValue={params.owner ?? ""}
          className="rounded-md border bg-background px-2 py-1.5 text-sm"
        >
          <option value="">Anyone</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>{m.full_name ?? m.email}</option>
          ))}
        </select>
        <select
          name="sort"
          defaultValue={params.sort ?? "recent"}
          className="rounded-md border bg-background px-2 py-1.5 text-sm"
        >
          <option value="recent">Last activity</option>
          <option value="added">Recently added</option>
          <option value="name">Name</option>
          <option value="readiness">Readiness</option>
        </select>
        <label className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" name="resumes" value="1" defaultChecked={params.resumes === "1"} />
          In resumes
        </label>
        <Button size="sm" variant="outline" type="submit">Search</Button>
      </form>

      {inResumes ? (
        <Panel title="Resume matches">
          {resumeHits.length === 0 ? <Empty>Nothing matched</Empty> : (
            <ul className="divide-y">
              {resumeHits.map((p) => (
                <li key={p.id} className="flex items-center gap-3 px-card py-cell-y">
                  <div className="min-w-0 flex-1">
                    <Link href={`/talent/people/${p.id}`} className="font-medium hover:underline">
                      {p.name}
                    </Link>
                    <p className="truncate text-meta text-muted-foreground">
                      {[p.title, p.company_name, place(p.city, p.state)].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  <span className="shrink-0 text-meta text-muted-foreground">{ago(p.last_activity_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      ) : (
        <Panel>
          {people.length === 0 ? <Empty>Nobody here yet</Empty> : (
            <TableScroll>
              <Table>
                <THead>
                  <TR>
                    <TH>Name</TH>
                    <TH>Company</TH>
                    <TH>Location</TH>
                    <TH>Type</TH>
                    <TH numeric>Pipelines</TH>
                    <TH numeric>Ready</TH>
                    <TH>Last activity</TH>
                  </TR>
                </THead>
                <TBody>
                  {people.map((p) => (
                    <TR key={p.id} interactive>
                      {/* A people list: the name is the whole cell, no avatar. */}
                      <TD>
                        <Link href={`/talent/people/${p.id}`} className="font-medium hover:underline">
                          {p.name}
                        </Link>
                        <div className="flex items-center gap-1.5 text-meta text-muted-foreground">
                          <span className="truncate">{p.title ?? "—"}</span>
                          {p.primary_email && <Mail className="h-3 w-3 shrink-0" aria-label="Has an email address" />}
                          {p.primary_phone && <Phone className="h-3 w-3 shrink-0" aria-label="Has a phone number" />}
                          {p.linkedin_url && <Linkedin className="h-3 w-3 shrink-0" aria-label="Has a LinkedIn profile" />}
                          {p.do_not_contact && <Ban className="h-3 w-3 shrink-0 text-destructive" aria-label="Do not contact" />}
                        </div>
                      </TD>
                      <TD className="text-muted-foreground">
                        {p.company_id ? (
                          <Link href={`/talent/companies/${p.company_id}`} className="hover:underline">
                            {p.company}
                          </Link>
                        ) : p.company ?? "—"}
                      </TD>
                      <TD className="text-muted-foreground">{place(p.city, p.state)}</TD>
                      <TD>
                        <span className="flex flex-wrap gap-1">
                          {p.person_types.map((t) => (
                            <Chip key={t}>{label(PERSON_TYPE, t)}</Chip>
                          ))}
                        </span>
                      </TD>
                      <TD numeric>{p.active_pipeline_count || "—"}</TD>
                      <TD numeric className="text-muted-foreground">{p.readiness_score ?? "—"}</TD>
                      <TD className="text-muted-foreground">{ago(p.last_activity_at)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableScroll>
          )}
        </Panel>
      )}

      {!inResumes && pages > 1 && (
        <div className="flex items-center gap-2 text-sm">
          {page > 1 && (
            <Link href={href({ page: String(page - 1) })} className="text-primary hover:underline">
              Previous
            </Link>
          )}
          <span className="text-muted-foreground tabular-nums">{page} of {pages}</span>
          {page < pages && (
            <Link href={href({ page: String(page + 1) })} className="text-primary hover:underline">
              Next
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
