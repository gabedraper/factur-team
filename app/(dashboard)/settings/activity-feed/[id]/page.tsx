import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { myPermissions } from "@/lib/org";
import { PageHeader } from "@/components/ui/page-header";
import { Surface } from "@/components/ui/surface";
import { Chip } from "@/components/pipeline/bits";
import { loadEvent, outcome, type FeedRow } from "@/lib/ingest/feed";

export const dynamic = "force-dynamic";

/*
 * One event, whole: the vendor's payload as it arrived, what the resolver read
 * out of it, and what it decided. This is the page to open when a call is not
 * where someone expected it.
 */

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  if (v === null || v === undefined || v === "") return null;
  return (
    <div className="grid grid-cols-[10rem_1fr] gap-2 py-1 text-body">
      <span className="text-muted-foreground">{k}</span>
      <span className="break-words">{v}</span>
    </div>
  );
}

function Json({ value }: { value: unknown }) {
  return (
    <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-meta">
      {JSON.stringify(value ?? null, null, 2)}
    </pre>
  );
}

export default async function ActivityEventPage({ params }: { params: Promise<{ id: string }> }) {
  const perms = await myPermissions();
  if (!perms.has("org.manage") && !perms.has("clients.activity_feed")) redirect("/settings");

  const { id } = await params;
  const found = await loadEvent(id);
  if (!found) notFound();
  const { row, names } = found;
  const f = row.resolution?.facts ?? {};
  const member = (row.member_id && names.members.get(row.member_id))
    ?? (row.resolution?.member_id && names.members.get(row.resolution.member_id))
    ?? null;
  const opp = row.resolution?.opportunity_id ? names.opportunities.get(row.resolution.opportunity_id) : null;

  return (
    <div className="space-y-4 p-section">
      <PageHeader
        back={{ href: "/settings/activity-feed", label: "Activity feed" }}
        title={f.subject ?? row.event_type ?? row.external_id}
        description={`${row.source} · ${row.external_id}`}
        actions={<Chip>{row.status.replace("_", " ")}</Chip>}
      />

      <Surface>
        <h2 className="text-section-title">What the app decided</h2>
        <Row k="Outcome" v={outcome(row, names)} />
        <Row k="Person" v={member ?? f.user_email} />
        <Row k="Opportunity" v={opp && row.resolution?.opportunity_id ? (
          <Link href={`/opportunities/${row.resolution.opportunity_id}`} className="hover:underline">
            {[opp.client, opp.name].filter(Boolean).join(" · ")}
          </Link>
        ) : null} />
        <Row k="Timeline row" v={row.opp_activity_id} />
        <Row k="Rules" v={row.resolution?.rules ? Object.entries(row.resolution.rules).map(([k, v]) => `${k}: ${v}`).join(", ") : null} />
        <Row k="Attempts" v={row.attempts} />
        <Row k="Received" v={new Date(row.received_at).toLocaleString()} />
      </Surface>

      <Surface>
        <h2 className="text-section-title">What the vendor said</h2>
        <Row k="Kind" v={[f.kind, f.direction].filter(Boolean).join(", ")} />
        <Row k="When" v={f.occurred_at ? new Date(f.occurred_at).toLocaleString() : null} />
        <Row k="Other party" v={[f.contact_name, f.other_email, f.other_phone_raw].filter(Boolean).join(" · ")} />
        <Row k="Outcome" v={f.outcome} />
        <Row k="Duration" v={typeof f.duration_secs === "number" ? `${f.duration_secs}s` : null} />
        <Row k="List" v={f.list_name} />
        <Row k="Sequence" v={f.sequence_name} />
      </Surface>

      <Surface>
        <h2 className="text-section-title">Resolution</h2>
        <Json value={row.resolution} />
      </Surface>

      <Surface>
        <h2 className="text-section-title">Payload, as received</h2>
        <Json value={(row as FeedRow).payload} />
      </Surface>
    </div>
  );
}
