import Link from "next/link";
import { requireTalent } from "@/lib/talent/access";
import { integrationStatus, listInterviews, listMembers } from "@/lib/talent/queries";
import { Chip, Empty, NotConnected, PageHeader, Panel } from "@/components/talent/bits";
import { onDay, onDayTime } from "@/lib/talent/format";
import { INTERVIEW_KIND, label } from "@/lib/talent/types";

export const dynamic = "force-dynamic";

/**
 * Interviews and meetings, grouped by day.
 *
 * Everything here is recorded whether or not Google Calendar is connected -- a
 * phone screen booked over the phone belongs on the schedule too. What the
 * integration adds is the invitation actually landing in somebody's calendar,
 * which is why its absence is stated at the top rather than left to be noticed.
 */
export default async function SchedulePage() {
  const access = await requireTalent("view");

  const from = new Date();
  from.setDate(from.getDate() - 7);
  const to = new Date();
  to.setDate(to.getDate() + 60);

  const [interviews, members, calendar] = await Promise.all([
    listInterviews({ from: from.toISOString(), to: to.toISOString() }),
    listMembers(),
    integrationStatus("google_calendar"),
  ]);

  type Row = Record<string, unknown> & {
    id: string; starts_at: string; kind: string; status: string;
    location: string | null; video_url: string | null;
    organizer_member_id: string | null;
    tal_people: { id: string; name: string; title: string | null } | null;
    tal_jobs: { id: string; title: string } | null;
  };
  const rows = interviews as Row[];
  const names = new Map(members.map((m) => [m.id, m.full_name ?? m.email]));

  const byDay = new Map<string, Row[]>();
  for (const r of rows) {
    const day = r.starts_at.slice(0, 10);
    byDay.set(day, [...(byDay.get(day) ?? []), r]);
  }
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="max-w-4xl space-y-4 p-6">
      <PageHeader title="Schedule" count={rows.length} />

      {calendar.status !== "connected" && (
        <NotConnected
          name={calendar.name}
          requires={calendar.requires}
          canAdmin={access.admin}
        />
      )}

      {byDay.size === 0 ? (
        <Panel><Empty>Nothing scheduled</Empty></Panel>
      ) : (
        [...byDay.entries()].map(([day, items]) => (
          <Panel
            key={day}
            title={
              <span className={day === today ? "text-primary" : undefined}>
                {onDay(day)}
                {day === today ? " · today" : ""}
              </span>
            }
          >
            <ul className="divide-y text-sm">
              {items.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5">
                  <span className="w-20 shrink-0 tabular-nums text-muted-foreground">
                    {new Date(i.starts_at).toLocaleTimeString("en-US", {
                      hour: "numeric", minute: "2-digit",
                    })}
                  </span>
                  <span className="min-w-0 flex-1">
                    {i.tal_people ? (
                      <Link href={`/talent/people/${i.tal_people.id}`} className="font-medium hover:underline">
                        {i.tal_people.name}
                      </Link>
                    ) : "—"}
                    <span className="block truncate text-xs text-muted-foreground">
                      {i.tal_jobs ? (
                        <Link href={`/talent/jobs/${i.tal_jobs.id}`} className="hover:underline">
                          {i.tal_jobs.title}
                        </Link>
                      ) : null}
                      {i.location ? ` · ${i.location}` : ""}
                      {i.organizer_member_id ? ` · ${names.get(i.organizer_member_id) ?? ""}` : ""}
                    </span>
                  </span>
                  <Chip colour={i.kind.includes("client") ? "violet" : "amber"}>
                    {label(INTERVIEW_KIND, i.kind)}
                  </Chip>
                  {i.status !== "scheduled" && <Chip colour="slate">{i.status}</Chip>}
                  {i.video_url && (
                    <a
                      href={i.video_url}
                      target="_blank"
                      rel="noreferrer"
                      className="shrink-0 text-xs text-primary hover:underline"
                    >
                      Join
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </Panel>
        ))
      )}
    </div>
  );
}
