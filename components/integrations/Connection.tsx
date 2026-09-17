import Link from "next/link";
import { ArrowDownToLine, ArrowUpFromLine, ArrowLeftRight, SlidersHorizontal } from "lucide-react";
import { Surface } from "@/components/ui/surface";
import { TableScroll, Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import type { IntegrationState } from "@/actions/integrations";

/* One connection, as the Integrations page has always described it: what it
   is, how it moves, what it leaves out, and the state of its tables. */

export function ago(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.round(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/** Anything older than this is worth a second look rather than a shrug. */
export function staleTone(iso: string | null): string {
  if (!iso) return "text-muted-foreground";
  const hours = (Date.now() - new Date(iso).getTime()) / 3600000;
  if (hours > 48) return "text-destructive font-medium";
  if (hours > 24) return "text-warning";
  return "text-muted-foreground";
}

export const DIRECTION = {
  in: { icon: ArrowDownToLine, label: "Reads into the app" },
  out: { icon: ArrowUpFromLine, label: "Sends out of the app" },
  both: { icon: ArrowLeftRight, label: "Both ways" },
} as const;

export function Connection({ i }: { i: IntegrationState }) {
  const Direction = DIRECTION[i.direction].icon;
  return (
    <Surface as="section" className="space-y-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-section-title">{i.name}</h2>
        <span className="inline-flex items-center gap-1 text-meta text-muted-foreground">
          <Direction className="h-3.5 w-3.5" />
          {DIRECTION[i.direction].label}
        </span>
        <span className="ml-auto text-meta text-muted-foreground">{i.ownedBy}</span>
      </div>

      <p className="max-w-3xl text-body">{i.what}</p>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <h3 className="text-meta font-medium uppercase tracking-wide text-muted-foreground">How it moves</h3>
          <p className="text-body text-muted-foreground">{i.transport}</p>
        </div>
        <div className="space-y-1">
          <h3 className="text-meta font-medium uppercase tracking-wide text-muted-foreground">Deliberately not included</h3>
          <ul className="space-y-1 text-body text-muted-foreground">
            {i.excluded.map((e) => <li key={e}>— {e}</li>)}
          </ul>
        </div>
      </div>

      {i.tableState.length > 0 && (
        <TableScroll className="rounded-md border">
          <Table>
            <THead>
              <TR><TH>Table</TH><TH numeric>Rows</TH><TH numeric>Size</TH><TH numeric>Last changed</TH></TR>
            </THead>
            <TBody>
              {i.tableState.map((t) => (
                <TR key={t.name} className="border-t">
                  <TD className="font-mono text-meta">{t.name}</TD>
                  <TD numeric>{t.missing ? <span className="text-destructive">absent</span> : (t.rows ?? 0).toLocaleString()}</TD>
                  <TD numeric className="text-muted-foreground">{t.size ?? "—"}</TD>
                  <TD numeric className={staleTone(t.lastChanged)}>{ago(t.lastChanged)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </TableScroll>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-meta text-muted-foreground">Feeds: {i.feeds.join(" · ")}</p>
        {i.configure && (
          <Link
            href={i.configure.href}
            title={i.configure.what}
            className="inline-flex shrink-0 items-center gap-2 rounded-md border px-3 py-1.5 text-body hover:bg-accent"
          >
            <SlidersHorizontal className="h-4 w-4" />
            {i.configure.label}
          </Link>
        )}
      </div>
    </Surface>
  );
}
