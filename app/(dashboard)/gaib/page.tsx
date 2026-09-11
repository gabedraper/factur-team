import { redirect } from "next/navigation";
import { createServiceClient } from "@/lib/supabase/server";
import { myPermissions } from "@/lib/org";
import type { Ticket } from "@/lib/gaib/tickets";
import { TicketCard, type TicketEvent } from "@/components/gaib/ticket-card";
import { PageHeader } from "@/components/ui/page-header";

export const dynamic = "force-dynamic";

/*
 * The queue.
 *
 * Ordered by what it wants from the reader rather than by date. The tickets
 * waiting on a decision come first because they are the only ones where
 * nothing happens until somebody looks; everything below them is either moving
 * on its own or already finished, and is here to be glanced at rather than
 * worked through.
 */
export default async function GaibPage() {
  const perms = await myPermissions();
  if (!perms.has("org.manage")) redirect("/");

  const db = createServiceClient();
  const { data } = await db
    .from("gaib_tickets")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);

  const tickets = (data ?? []) as Ticket[];

  // Names in one lookup rather than one per card.
  const { data: people } = await db
    .from("profiles")
    .select("id,full_name")
    .in("id", [...new Set(tickets.map((t) => t.raised_by).filter(Boolean))] as string[]);
  const names = new Map(
    ((people ?? []) as { id: string; full_name: string | null }[])
      .map((p) => [p.id, p.full_name])
  );
  // Everything that happened to each ticket, one query for the page.
  const { data: events } = await db
    .from("gaib_ticket_events")
    .select("ticket_id,actor,event,detail,created_at")
    .in("ticket_id", tickets.map((t) => t.id))
    .order("created_at", { ascending: true });
  const history = new Map<string, TicketEvent[]>();
  for (const e of (events ?? []) as (TicketEvent & { ticket_id: string })[]) {
    const list = history.get(e.ticket_id) ?? [];
    list.push(e);
    history.set(e.ticket_id, list);
  }
  const card = (t: Ticket, decidable = false) => (
    <TicketCard
      key={t.id}
      ticket={t}
      raisedByName={names.get(t.raised_by ?? "")}
      decidable={decidable}
      history={history.get(t.id) ?? []}
    />
  );

  const waiting = tickets.filter((t) => t.status === "awaiting_review");
  const broken = tickets.filter((t) => t.status === "failed");
  const moving = tickets.filter((t) => ["new", "queued", "running"].includes(t.status));
  const done = tickets.filter((t) =>
    ["shipped", "rejected", "duplicate"].includes(t.status)
  ).slice(0, 30);

  return (
    <div className="mx-auto max-w-4xl space-y-8 p-6">
      <PageHeader title="Gaib" />

      <Section title="Waiting on you" count={waiting.length}>
        {waiting.map((t) => card(t, true))}
      </Section>

      {broken.length > 0 && (
        <Section title="Failed" count={broken.length}>
          {broken.map((t) => card(t, true))}
        </Section>
      )}

      <Section title="In flight" count={moving.length}>
        {moving.map((t) => card(t))}
      </Section>

      <Section title="Closed" count={done.length}>
        {done.map((t) => card(t))}
      </Section>
    </div>
  );
}

function Section({
  title, count, children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <h2 className="flex items-baseline gap-2 text-sm font-medium text-muted-foreground">
        {title}
        <span className="text-xs tabular-nums">{count}</span>
      </h2>
      {count === 0 ? (
        <p className="text-sm text-muted-foreground">—</p>
      ) : (
        <div className="space-y-3">{children}</div>
      )}
    </section>
  );
}
