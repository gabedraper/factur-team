import Link from "next/link";
import { notFound } from "next/navigation";
import { Ban, Linkedin } from "lucide-react";
import { requireTalent } from "@/lib/talent/access";
import {
  getPerson, integrationStatus, listActivityTypes, listEmailTemplates,
  listMembers, listNoteTemplates,
} from "@/lib/talent/queries";
import { PersonEditor } from "@/components/talent/PersonEditor";
import { Documents } from "@/components/talent/Documents";
import { AddToJob } from "@/components/talent/AddToJob";
import { EmailPerson } from "@/components/talent/EmailPerson";
import { ActivityFeed } from "@/components/talent/ActivityFeed";
import { LogActivity } from "@/components/talent/LogActivity";
import { Avatar, Chip, Empty, Panel, Stat, Tabs } from "@/components/talent/bits";
import { ago, onDay, place } from "@/lib/talent/format";
import { CANDIDATE_STATUS, PERSON_TYPE, RECOMMENDATION, label } from "@/lib/talent/types";

export const dynamic = "force-dynamic";

const TABS = [
  { key: "profile", label: "Profile" },
  { key: "activity", label: "Activity" },
  { key: "pipelines", label: "Pipelines" },
  { key: "documents", label: "Documents" },
  { key: "scorecards", label: "Scorecards" },
];

/**
 * One person, everywhere they appear.
 *
 * Loxo's arrangement, and the right one: the record is the person, and the jobs
 * they are on are a tab rather than a separate life. Whoever picks the phone up
 * needs to see in one screen that this candidate was already spoken to about
 * something else in March.
 */
export default async function PersonPage({
  params, searchParams,
}: {
  params: Promise<{ personId: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const access = await requireTalent("view");
  const { personId } = await params;
  const tab = (await searchParams).tab ?? "profile";

  const data = await getPerson(personId);
  if (!data) notFound();
  const { person, history, education, documents, pipelines, activities, tasks, tags, scorecards } = data;

  const [members, types, templates, emailTemplates, gmail] = await Promise.all([
    listMembers(), listActivityTypes(), listNoteTemplates("person"),
    listEmailTemplates("candidate"), integrationStatus("gmail"),
  ]);
  const authors = new Map(members.map((m) => [m.id, m.full_name ?? m.email]));

  // A merged record still resolves, so an old bookmark lands somewhere useful
  // rather than on a 404 that suggests the person was deleted.
  if (person.merged_into_id) {
    return (
      <div className="max-w-xl space-y-3 p-6">
        <h1 className="text-xl font-semibold">{person.name}</h1>
        <p className="text-sm text-muted-foreground">Merged</p>
        <Link href={`/talent/people/${person.merged_into_id}`} className="text-primary hover:underline">
          Open the surviving record
        </Link>
      </div>
    );
  }

  const tabs = TABS.map((t) => ({
    ...t,
    count:
      t.key === "pipelines" ? pipelines.length :
      t.key === "documents" ? documents.length :
      t.key === "scorecards" ? scorecards.length :
      t.key === "activity" ? activities.length : undefined,
  }));

  return (
    <div className="space-y-4 p-6">
      <div className="flex flex-wrap items-start gap-4">
        <Avatar name={person.name} size={12} />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold">{person.name}</h1>
            {person.do_not_contact && (
              <Chip colour="rose">
                <Ban className="h-3 w-3" />
                Do not contact
              </Chip>
            )}
            {person.person_types.map((t) => (
              <Chip key={t}>{label(PERSON_TYPE, t)}</Chip>
            ))}
            {tags.map((t) => (
              <Chip key={t.id} colour={t.color}>{t.label}</Chip>
            ))}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {[person.title, person.company_name, place(person.city, person.state)]
              .filter(Boolean).join(" · ") || "—"}
          </p>
          {person.linkedin_url && (
            <a
              href={person.linkedin_url}
              target="_blank"
              rel="noreferrer"
              className="mt-1 inline-flex items-center gap-1 text-sm text-primary hover:underline"
            >
              <Linkedin className="h-3.5 w-3.5" />
              LinkedIn
            </a>
          )}
        </div>

        <div className="ml-auto flex flex-wrap items-start gap-2">
          {access.recruit && (
            <EmailPerson
              personId={person.id}
              personName={person.first_name ?? person.name}
              to={person.primary_email}
              templates={emailTemplates}
              blocked={
                gmail.status !== "connected" ? "Gmail not connected"
                  : person.do_not_contact ? "Do not contact"
                  : person.unsubscribed_at ? "Unsubscribed"
                  : !person.primary_email ? "No email address"
                  : null
              }
            />
          )}
          {access.recruit && <AddToJob personId={person.id} />}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 rounded-lg border bg-card px-4 py-3 sm:grid-cols-5">
        <Stat label="Readiness" value={person.readiness_score ?? "—"} />
        <Stat label="In pipeline" value={pipelines.filter((p) => p.status === "active").length} />
        <Stat label="Activity" value={activities.length} />
        <Stat label="Last touched" value={ago(person.last_activity_at)} />
        <Stat label="Added" value={onDay(person.created_at)} />
      </div>

      <Tabs tabs={tabs} active={tab} base={`/talent/people/${person.id}`} />

      {tab === "profile" && (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <PersonEditor
              person={person}
              history={history as never[]}
              education={education as never[]}
              members={members}
              canEdit={access.recruit}
            />
          </div>

          <div className="space-y-4">
            <Panel title="Open tasks">
              {tasks.length === 0 ? <Empty>None</Empty> : (
                <ul className="divide-y text-sm">
                  {tasks.map((t) => (
                    <li key={t.id} className="flex gap-2 px-4 py-2">
                      <span className="min-w-0 flex-1 truncate">{t.title}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">{onDay(t.due_at)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel title="Resume">
              <Documents
                personId={person.id}
                documents={documents as never[]}
                canEdit={access.recruit}
              />
            </Panel>
          </div>
        </div>
      )}

      {tab === "activity" && (
        <Panel>
          {access.recruit && (
            <LogActivity types={types} templates={templates} personId={person.id} />
          )}
          <ActivityFeed activities={activities} authors={authors} />
        </Panel>
      )}

      {tab === "pipelines" && (
        <Panel>
          {pipelines.length === 0 ? <Empty>Not on any job</Empty> : (
            <table className="w-full text-sm">
              <thead className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">Job</th>
                  <th className="px-4 py-2 font-medium">Company</th>
                  <th className="px-4 py-2 font-medium">Stage</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 text-right font-medium">Days in stage</th>
                  <th className="px-4 py-2 font-medium">Added</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {pipelines.map((p) => (
                  <tr key={p.candidate_id}>
                    <td className="px-4 py-2">
                      <Link href={`/talent/jobs/${p.job_id}`} className="font-medium hover:underline">
                        {p.job_title}
                      </Link>
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">{p.company_name ?? "—"}</td>
                    <td className="px-4 py-2">
                      <Chip colour={p.stage_color}>{p.stage_name ?? "—"}</Chip>
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {label(CANDIDATE_STATUS, p.status)}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
                      {p.days_in_stage}
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">{onDay(p.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      )}

      {tab === "documents" && (
        <Panel>
          <Documents personId={person.id} documents={documents as never[]} canEdit={access.recruit} />
        </Panel>
      )}

      {tab === "scorecards" && (
        <Panel>
          {scorecards.length === 0 ? <Empty>None</Empty> : (
            <ul className="divide-y">
              {scorecards.map((s) => {
                const row = s as Record<string, unknown> & {
                  id: string; overall_rating: number | null; recommendation: string | null;
                  strengths: string | null; concerns: string | null; created_at: string;
                  interviewer_member_id: string | null; interviewer_name: string | null;
                  tal_jobs: { title: string } | null;
                };
                return (
                  <li key={row.id} className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{row.tal_jobs?.title ?? "—"}</span>
                      {row.recommendation && (
                        <Chip
                          colour={
                            row.recommendation.includes("yes") ? "emerald"
                              : row.recommendation.includes("no") ? "rose" : "slate"
                          }
                        >
                          {label(RECOMMENDATION, row.recommendation)}
                        </Chip>
                      )}
                      <span className="text-xs text-muted-foreground">
                        {row.interviewer_name
                          ?? (row.interviewer_member_id ? authors.get(row.interviewer_member_id) : null)
                          ?? "—"}
                      </span>
                      <span className="ml-auto text-xs text-muted-foreground">{ago(row.created_at)}</span>
                    </div>
                    {row.strengths && <p className="mt-1 text-sm">{row.strengths}</p>}
                    {row.concerns && <p className="mt-1 text-sm text-muted-foreground">{row.concerns}</p>}
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      )}
    </div>
  );
}
