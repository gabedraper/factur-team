import { redirect } from "next/navigation";
import { createServiceClient } from "@/lib/supabase/server";
import { myPermissions } from "@/lib/org";
import type { Ticket } from "@/lib/gaib/tickets";
import { TicketCard } from "@/components/gaib/ticket-card";

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
  const waiting = tickets.filter((t) => t.status === "awaiting_review");
  const broken = tickets.filter((t) => t.status === "failed");
  const moving = tickets.filter((t) => ["new", "queued", "running"].includes(t.status));
  const done = tickets.filter((t) =>
    ["shipped", "rejected", "duplicate"].includes(t.status)
  ).slice(0, 30);

  return (
    <div className="mx-auto max-w-4xl space-y-8 p-6">
      <h1 className="text-xl font-semibold">Gaib</h1>

      <Section title="Waiting on you" count={waiting.length}>
        {waiting.map((t) => <TicketCard key={t.id} ticket={t} decidable />)}
      </Section>

      {broken.length > 0 && (
        <Section title="Failed" count={broken.length}>
          {broken.map((t) => <TicketCard key={t.id} ticket={t} decidable />)}
        </Section>
      )}

      <Section title="In flight" count={moving.length}>
        {moving.map((t) => <TicketCard key={t.id} ticket={t} />)}
      </Section>

      <Section title="Closed" count={done.length}>
        {done.map((t) => <TicketCard key={t.id} ticket={t} />)}
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
